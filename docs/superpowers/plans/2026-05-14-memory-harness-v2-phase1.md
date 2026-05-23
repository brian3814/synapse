# Memory Harness v2 Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat memory dump with a governed write path (tags, supersession) and modular retrieval pipeline (metadata retriever, RRF fusion, annotated formatter), plus unify episodic memories into files.

**Architecture:** Files in `.kg/agent/memory/` remain the source of truth. Extended frontmatter adds `tags`, `superseded_by`, `valid`, `access_count`, `last_accessed`. The read path runs a pluggable retrieval pipeline (metadata retriever → RRF fuser → annotated formatter). Episodic summaries move from the DB `memory_episodic` table to files with `type: episodic`. Vector retriever and background consolidation are deferred to Phase 2.

**Tech Stack:** TypeScript, file I/O via `PlatformFiles`, Anthropic API (Haiku for summarization)

**Phase 2 (deferred):** Vector retriever (`vec_memories` table + EmbeddingService), background consolidation (dedup, tag enrichment, re-embed).

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/memory/types.ts` | `RankedMemory`, `MemoryRetriever`, `MemoryFuser`, `MemoryFormatter` interfaces |
| `src/memory/pipeline.ts` | `retrieveMemories()` pipeline runner |
| `src/memory/retrievers/metadata-retriever.ts` | Tag/keyword matching with weighted scoring |
| `src/memory/fusers/rrf-fuser.ts` | Reciprocal rank fusion (single-retriever passthrough when only one) |
| `src/memory/formatters/annotated-formatter.ts` | `[type, ★★★] content` formatted output |
| `src/memory/governance.ts` | Supersession helpers: mark old memory invalid, update frontmatter |
| `src/utils/text-search.ts` | Extract `extractSearchTerms()` from `rag-commands.ts` into shared utility |

### Modified Files
| File | Change |
|---|---|
| `src/commands/memory-commands.ts` | Extend `MemoryEntry` with new fields; extend `parseFrontmatter` for arrays/booleans/numbers; extend `generateMemoryFile` for new fields; add `tags`/`supersedes` to `WriteMemoryInput`; add `VALID_TYPES` → include `'episodic'`; update `loadAllForPrompt` → `loadValidMemories` (filter `valid !== false`) |
| `src/shared/chat-agent-tools.ts` | Add `tags` (string[]) and `supersedes` (string) to `manage_memory` tool schema |
| `src/core/prompt-assembler.ts` | Change `PromptContext.semanticMemories` → `memoryContext: string`; change `recentSessionSummaries` to include `created_at`; add "Memory Guidelines" section |
| `src/core/memory-extractor.ts` | Richer summarization (JSON output: summary + tags + slug); write episodic file instead of DB insert |
| `src/ui/hooks/useChatSession.ts` | Replace `loadAllForPrompt()` + `getRecentEpisodic()` with pipeline `retrieveMemories()`; pass `memoryContext` string to assembler |
| `src/commands/rag-commands.ts` | Import `extractSearchTerms` from `src/utils/text-search.ts` instead of local definition |

---

### Task 1: Shared Text Search Utility

**Files:**
- Create: `src/utils/text-search.ts`
- Modify: `src/commands/rag-commands.ts`

- [ ] **Step 1: Create shared utility with extracted function**

```typescript
// src/utils/text-search.ts

const STOP_WORDS = new Set([
  'what', 'who', 'where', 'when', 'why', 'how', 'is', 'are', 'was', 'were',
  'do', 'does', 'did', 'have', 'has', 'had', 'can', 'could', 'would', 'should',
  'will', 'shall', 'may', 'might', 'the', 'a', 'an', 'and', 'or', 'but', 'in',
  'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'about', 'between',
  'through', 'during', 'before', 'after', 'above', 'below', 'up', 'down',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'they', 'them', 'their',
  'it', 'its', 'this', 'that', 'these', 'those', 'know', 'tell', 'give',
  'find', 'show', 'get', 'all', 'any', 'some', 'every', 'each', 'much',
  'many', 'more', 'most', 'other', 'another', 'such', 'no', 'not', 'only',
  'very', 'just', 'also', 'than', 'too', 'so', 'if', 'then', 'because',
  'while', 'although', 'though', 'even', 'still', 'already', 'yet',
]);

export function extractSearchTerms(question: string): string[] {
  const quotedPhrases: string[] = [];
  const withoutQuotes = question.replace(/"([^"]+)"/g, (_, phrase) => {
    quotedPhrases.push(phrase.trim());
    return '';
  });

  const words = withoutQuotes
    .toLowerCase()
    .replace(/[^\w\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  return [...quotedPhrases, ...words];
}
```

- [ ] **Step 2: Update `rag-commands.ts` to import from shared utility**

In `src/commands/rag-commands.ts`, replace the local `extractSearchTerms` function (lines 34-62) and `STOP_WORDS` with an import:

```typescript
import { extractSearchTerms } from '../utils/text-search';
```

Delete the local `extractSearchTerms` function and the inline stop words set. The `reciprocalRankFusion` function stays — it's specific to node search (takes `nodeId`/`score` pairs).

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/utils/text-search.ts src/commands/rag-commands.ts
git commit -m "refactor: extract extractSearchTerms to shared utility"
```

---

### Task 2: Extend MemoryEntry and Frontmatter Parsing

**Files:**
- Modify: `src/commands/memory-commands.ts`

- [ ] **Step 1: Extend MemoryEntry interface**

Update the `MemoryEntry` interface at the top of `src/commands/memory-commands.ts`:

```typescript
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
```

- [ ] **Step 2: Extend `VALID_TYPES` to include `'episodic'`**

```typescript
const VALID_TYPES = ['preference', 'fact', 'instruction', 'episodic'];
```

- [ ] **Step 3: Update `parseFrontmatter` to handle arrays, booleans, and numbers**

Replace the `parseFrontmatter` function:

```typescript
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

    // YAML array: [item1, item2]
    if (value.startsWith('[') && value.endsWith(']')) {
      meta[key] = value.slice(1, -1).split(',').map((s) => s.trim()).filter(Boolean);
      continue;
    }
    // YAML boolean
    if (value === 'true') { meta[key] = true; continue; }
    if (value === 'false') { meta[key] = false; continue; }
    // YAML null
    if (value === '' || value === 'null') { meta[key] = null; continue; }
    // YAML number
    if (/^\d+$/.test(value)) { meta[key] = parseInt(value, 10); continue; }
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }

  return { meta, body };
}
```

- [ ] **Step 4: Update `generateMemoryFile` for new fields**

Replace `generateMemoryFile`:

```typescript
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
```

- [ ] **Step 5: Update all places that construct `MemoryEntry` from parsed frontmatter**

In `listMemories`, update the entry construction:

```typescript
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
```

In `readMemory`, same update:

```typescript
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
```

- [ ] **Step 6: Add `loadValidMemories` function**

Add a new function that replaces `loadAllForPrompt` as the primary memory loader (keep `loadAllForPrompt` for backward compat but have it delegate):

```typescript
export async function loadValidMemories(ctx: CommandContext): Promise<MemoryEntry[]> {
  const all = await listMemories(ctx);
  return all.filter((e) => e.valid !== false);
}
```

- [ ] **Step 7: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/commands/memory-commands.ts
git commit -m "feat(memory-v2): extend MemoryEntry with tags, valid, supersession, access tracking"
```

---

### Task 3: Write Path — Tags and Supersession

**Files:**
- Modify: `src/commands/memory-commands.ts`
- Modify: `src/shared/chat-agent-tools.ts`
- Create: `src/memory/governance.ts`

- [ ] **Step 1: Create governance helpers**

```typescript
// src/memory/governance.ts

import type { CommandContext } from '../commands/types';
import { readMemory } from '../commands/memory-commands';

export async function markSuperseded(
  ctx: CommandContext,
  oldFilename: string,
  newFilename: string,
): Promise<void> {
  const raw = await ctx.files.read(`memory/${oldFilename}`);
  if (!raw) return;

  const updated = raw.replace(
    /^superseded_by:.*$/m,
    `superseded_by: ${newFilename}`,
  ).replace(
    /^valid:.*$/m,
    'valid: false',
  );

  await ctx.files.write(`memory/${oldFilename}`, updated);
}

export async function updateAccessStats(
  ctx: CommandContext,
  filename: string,
): Promise<void> {
  const raw = await ctx.files.read(`memory/${filename}`);
  if (!raw) return;

  const now = new Date().toISOString();
  let updated = raw.replace(
    /^access_count: (\d+)$/m,
    (_, count) => `access_count: ${parseInt(count, 10) + 1}`,
  );
  updated = updated.replace(
    /^last_accessed:.*$/m,
    `last_accessed: ${now}`,
  );

  await ctx.files.write(`memory/${filename}`, updated);
}
```

- [ ] **Step 2: Extend `WriteMemoryInput` and `writeMemory` for tags/supersedes**

In `src/commands/memory-commands.ts`, update `WriteMemoryInput`:

```typescript
interface WriteMemoryInput {
  action: 'create' | 'update' | 'delete' | 'list';
  filename?: string;
  type?: string;
  name?: string;
  description?: string;
  content?: string;
  tags?: string[];
  supersedes?: string;
}
```

In the `writeMemory` function, update the `action === 'create'` branch. After writing the new file and before `regenerateIndex`, add supersession logic:

```typescript
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

    const filename = input.type === 'episodic'
      ? `episodic_${input.name}.md`
      : `${input.type}_${input.name}.md`;
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
      tags: input.tags,
    });

    await ctx.files.write(`memory/${filename}`, content);

    // Handle supersession
    if (input.supersedes) {
      const { markSuperseded } = await import('../memory/governance');
      await markSuperseded(ctx, input.supersedes, filename);
    }

    await regenerateIndex(ctx);
    return filename;
  }
```

Also update the `update` branch to pass tags through:

```typescript
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
      tags: input.tags ?? existing.tags,
      superseded_by: existing.superseded_by,
      valid: existing.valid,
      access_count: existing.access_count,
      last_accessed: existing.last_accessed,
    });

    await ctx.files.write(`memory/${input.filename}`, updated);
    await regenerateIndex(ctx);
    return input.filename;
  }
```

- [ ] **Step 3: Update `executeManageMemory` to pass tags/supersedes**

In the `executeManageMemory` function, add the new fields to the `writeMemory` call:

```typescript
    const filename = await writeMemory(ctx, {
      action: action as 'create' | 'update' | 'delete',
      filename: input.filename as string | undefined,
      type: input.type as string | undefined,
      name: input.name as string | undefined,
      description: input.description as string | undefined,
      content: input.content as string | undefined,
      tags: input.tags as string[] | undefined,
      supersedes: input.supersedes as string | undefined,
    });
```

- [ ] **Step 4: Add `tags` and `supersedes` to manage_memory tool schema**

In `src/shared/chat-agent-tools.ts`, find the `manage_memory` tool definition. Add two new properties to its `parameters.properties`:

```typescript
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords for retrieval (3-5 tags)',
        },
        supersedes: {
          type: 'string',
          description: 'Filename of the memory this one replaces (marks old one invalid)',
        },
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/memory/governance.ts src/commands/memory-commands.ts src/shared/chat-agent-tools.ts
git commit -m "feat(memory-v2): governed write path with tags and supersession"
```

---

### Task 4: Retrieval Pipeline Types and Runner

**Files:**
- Create: `src/memory/types.ts`
- Create: `src/memory/pipeline.ts`

- [ ] **Step 1: Create retrieval types**

```typescript
// src/memory/types.ts

import type { MemoryEntry } from '../commands/memory-commands';

export interface RankedMemory {
  entry: MemoryEntry;
  score: number;
  source: string;
}

export interface MemoryRetriever {
  name: string;
  enabled: () => boolean;
  retrieve: (query: string, memories: MemoryEntry[]) => RankedMemory[];
}

export interface MemoryFuser {
  fuse: (results: Map<string, RankedMemory[]>) => RankedMemory[];
}

export interface MemoryFormatter {
  format: (memories: RankedMemory[], budget: number) => string;
}

export interface RetrievalOptions {
  topK: number;
  charBudget: number;
}
```

- [ ] **Step 2: Create pipeline runner**

```typescript
// src/memory/pipeline.ts

import type { MemoryEntry } from '../commands/memory-commands';
import type { MemoryRetriever, MemoryFuser, MemoryFormatter, RankedMemory, RetrievalOptions } from './types';
import type { CommandContext } from '../commands/types';
import { updateAccessStats } from './governance';

export async function retrieveMemories(
  query: string,
  memories: MemoryEntry[],
  retrievers: MemoryRetriever[],
  fuser: MemoryFuser,
  formatter: MemoryFormatter,
  options: RetrievalOptions,
  ctx?: CommandContext,
): Promise<{ formatted: string; retrieved: RankedMemory[] }> {
  const active = retrievers.filter((r) => r.enabled());

  if (active.length === 0 || memories.length === 0) {
    return { formatted: '', retrieved: [] };
  }

  // Run all retrievers
  const resultsMap = new Map<string, RankedMemory[]>();
  for (const retriever of active) {
    const results = retriever.retrieve(query, memories);
    resultsMap.set(retriever.name, results);
  }

  // Fuse or pass through
  let fused: RankedMemory[];
  if (resultsMap.size === 1) {
    fused = [...resultsMap.values()][0];
  } else {
    fused = fuser.fuse(resultsMap);
  }

  // Take top-K
  const topK = fused.slice(0, options.topK);

  // Update access stats (fire-and-forget)
  if (ctx) {
    for (const rm of topK) {
      updateAccessStats(ctx, rm.entry.filename).catch(() => {});
    }
  }

  const formatted = formatter.format(topK, options.charBudget);
  return { formatted, retrieved: topK };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/memory/types.ts src/memory/pipeline.ts
git commit -m "feat(memory-v2): retrieval pipeline types and runner"
```

---

### Task 5: Metadata Retriever

**Files:**
- Create: `src/memory/retrievers/metadata-retriever.ts`

- [ ] **Step 1: Create the metadata retriever**

```typescript
// src/memory/retrievers/metadata-retriever.ts

import type { MemoryEntry } from '../../commands/memory-commands';
import type { MemoryRetriever, RankedMemory } from '../types';
import { extractSearchTerms } from '../../utils/text-search';

const WEIGHT_TAG_MATCH = 2.0;
const WEIGHT_CONTENT_MATCH = 1.0;
const BONUS_RECENT = 0.5;
const BONUS_FREQUENT = 0.3;
const BONUS_INSTRUCTION = 0.2;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FREQUENCY_THRESHOLD = 5;
const FALLBACK_COUNT = 3;

export function createMetadataRetriever(): MemoryRetriever {
  return {
    name: 'metadata',
    enabled: () => true,

    retrieve(query: string, memories: MemoryEntry[]): RankedMemory[] {
      const terms = extractSearchTerms(query);
      const termSet = new Set(terms.map((t) => t.toLowerCase()));
      const now = Date.now();

      const scored: RankedMemory[] = memories.map((entry) => {
        let score = 0;

        // Tag matches
        for (const tag of entry.tags) {
          if (termSet.has(tag.toLowerCase())) {
            score += WEIGHT_TAG_MATCH;
          }
        }

        // Content word matches
        const contentWords = entry.content.toLowerCase().split(/\s+/);
        const descWords = entry.description.toLowerCase().split(/\s+/);
        const allWords = new Set([...contentWords, ...descWords]);
        for (const term of termSet) {
          if (allWords.has(term)) {
            score += WEIGHT_CONTENT_MATCH;
          }
        }

        // Recency bonus
        if (entry.updated_at) {
          const updatedMs = new Date(entry.updated_at).getTime();
          if (now - updatedMs < RECENCY_WINDOW_MS) {
            score += BONUS_RECENT;
          }
        }

        // Frequency bonus
        if (entry.access_count > FREQUENCY_THRESHOLD) {
          score += BONUS_FREQUENT;
        }

        // Instruction type bonus
        if (entry.type === 'instruction') {
          score += BONUS_INSTRUCTION;
        }

        return { entry, score, source: 'metadata' };
      });

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      // Fallback: if no keyword/tag matches, return top by access_count
      const hasMatches = scored.some((s) => s.score > BONUS_RECENT + BONUS_FREQUENT + BONUS_INSTRUCTION);
      if (!hasMatches) {
        const byAccess = [...memories]
          .sort((a, b) => b.access_count - a.access_count)
          .slice(0, FALLBACK_COUNT);
        return byAccess.map((entry, i) => ({
          entry,
          score: 1 / (1 + i),
          source: 'metadata-fallback',
        }));
      }

      return scored.filter((s) => s.score > 0);
    },
  };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/memory/retrievers/metadata-retriever.ts
git commit -m "feat(memory-v2): metadata retriever with tag/keyword scoring"
```

---

### Task 6: RRF Fuser and Annotated Formatter

**Files:**
- Create: `src/memory/fusers/rrf-fuser.ts`
- Create: `src/memory/formatters/annotated-formatter.ts`

- [ ] **Step 1: Create the RRF fuser**

```typescript
// src/memory/fusers/rrf-fuser.ts

import type { MemoryFuser, RankedMemory } from '../types';

const RRF_K = 60;

export function createRRFFuser(): MemoryFuser {
  return {
    fuse(results: Map<string, RankedMemory[]>): RankedMemory[] {
      const scores = new Map<string, { memory: RankedMemory; score: number }>();

      for (const [, rankedList] of results) {
        for (let rank = 0; rank < rankedList.length; rank++) {
          const rm = rankedList[rank];
          const key = rm.entry.filename;
          const existing = scores.get(key);
          const rrfScore = 1 / (RRF_K + rank);

          if (existing) {
            existing.score += rrfScore;
          } else {
            scores.set(key, { memory: rm, score: rrfScore });
          }
        }
      }

      return [...scores.values()]
        .sort((a, b) => b.score - a.score)
        .map(({ memory, score }) => ({ ...memory, score }));
    },
  };
}
```

- [ ] **Step 2: Create the annotated formatter**

```typescript
// src/memory/formatters/annotated-formatter.ts

import type { MemoryFormatter, RankedMemory } from '../types';

function confidenceStars(score: number, maxScore: number): string {
  if (maxScore <= 0) return '★☆☆';
  const ratio = score / maxScore;
  if (ratio > 0.66) return '★★★';
  if (ratio > 0.33) return '★★☆';
  return '★☆☆';
}

export function createAnnotatedFormatter(): MemoryFormatter {
  return {
    format(memories: RankedMemory[], budget: number): string {
      if (memories.length === 0) return '';

      const maxScore = memories[0].score;
      const lines: string[] = [];
      let totalChars = 0;

      for (const rm of memories) {
        const stars = confidenceStars(rm.score, maxScore);
        const line = `- [${rm.entry.type}, ${stars}] ${rm.entry.content.replace(/\n/g, ' ').trim()}`;

        if (totalChars + line.length > budget) break;
        lines.push(line);
        totalChars += line.length;
      }

      return lines.join('\n');
    },
  };
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/memory/fusers/rrf-fuser.ts src/memory/formatters/annotated-formatter.ts
git commit -m "feat(memory-v2): RRF fuser and annotated formatter"
```

---

### Task 7: Update Prompt Assembly

**Files:**
- Modify: `src/core/prompt-assembler.ts`

- [ ] **Step 1: Update `PromptContext` and `assembleSystemPrompt`**

Replace the entire file:

```typescript
// src/core/prompt-assembler.ts

export const BASE_CHAT_SYSTEM_PROMPT = `You are a helpful assistant integrated into a personal knowledge graph browser extension. You have access to tools that let you search, read, and modify the user's knowledge graph.

## Citation Rules (MANDATORY)
- When referencing information from the knowledge graph, you MUST cite the source URL using [Source: url] format.
- When mentioning ANY entity from the graph, ALWAYS use the clickable format: [Entity Name](node:entity-id). The entity-id comes from the id field in tool results.
- Every factual claim from the knowledge graph should be traceable to a source or entity.
- If a tool result includes source URLs, cite them in your answer.

## Tool Usage Strategy

**For knowledge questions ("What do I know about X?", "Tell me about X"):**
1. Start with search_knowledge — it finds entities, expands to connected neighbors, and retrieves source content in one call
2. If you need more detail on a specific entity, follow up with get_node_details or get_neighbors
3. If you need the full source text, use get_source_content

**For graph exploration ("How does X connect to Y?", "What's related to X?"):**
1. Use search_nodes to find starting entities
2. Use get_neighbors or get_edges_for_node to trace connections
3. Explain the paths you find

**For requests to modify the graph:**
1. First search to check if entities already exist (avoid duplicates)
2. Use create_node / create_edge to add new data
3. Use update_node to modify existing entities
4. Confirm what you created/updated

**When no tools are needed:**
- Answer general questions using your own knowledge
- If the question doesn't relate to the graph, just respond normally

## Response Format
- Use [Entity Name](node:entity-id) for EVERY entity you mention from the graph
- Use [Source: url] for EVERY source you reference
- Use markdown formatting (bold, lists, headers)
- Be concise but thorough
- If search returns no results, say so clearly`;

const MEMORY_GUIDELINES = `## Memory Guidelines
When you learn something worth remembering:
1. Check if it contradicts or duplicates a memory shown above
2. If contradicting: use manage_memory with supersedes to replace the old one
3. If new: use manage_memory with descriptive tags for future retrieval
4. Skip ephemeral information — only save durable preferences, facts, or instructions`;

export interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  memoryContext: string;
  recentSessionSummaries: Array<{ summary: string; created_at?: string }>;
}

export function assembleSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [BASE_CHAT_SYSTEM_PROMPT];

  if (ctx.globalInstructions) {
    sections.push(`## Custom Instructions\n${ctx.globalInstructions}`);
  }

  if (ctx.presetPrompt) {
    sections.push(`## Session Mode: ${ctx.presetName ?? 'Custom'}\n${ctx.presetPrompt}`);
  }

  if (ctx.memoryContext) {
    sections.push(`## What I Know About You\n${ctx.memoryContext}`);
  }

  if (ctx.recentSessionSummaries.length > 0) {
    const lines = ctx.recentSessionSummaries.map((s) => {
      const dateStr = s.created_at
        ? `(${new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}) `
        : '';
      return `- ${dateStr}${s.summary}`;
    });
    sections.push(`## Recent Sessions\n${lines.join('\n')}`);
  }

  sections.push(MEMORY_GUIDELINES);

  return sections.join('\n\n');
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: Errors in `useChatSession.ts` because `PromptContext` changed (we fix that in Task 9).

- [ ] **Step 3: Commit**

```bash
git add src/core/prompt-assembler.ts
git commit -m "feat(memory-v2): update prompt assembly for pipeline output + memory guidelines"
```

---

### Task 8: Episodic Memory Unification

**Files:**
- Modify: `src/core/memory-extractor.ts`

- [ ] **Step 1: Update session summarization to write episodic files**

Replace `src/core/memory-extractor.ts`:

```typescript
import { llm, files } from '@platform';
import { chat } from '../db/client/db-client';
import { LLM_MODELS } from '../shared/constants';
import { writeMemory } from '../commands/memory-commands';
import { createUICommandContext } from '../commands/create-context';

export async function summarizeSession(sessionId: string): Promise<void> {
  try {
    const messages = await chat.getRecentMessages(sessionId, 20);
    if (!messages || (messages as any[]).length < 4) return;

    const transcript = (messages as any[])
      .map((m: any) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content.substring(0, 500)}`)
      .join('\n\n');

    const requestId = crypto.randomUUID();
    const result = await llm.streamChat(
      {
        requestId,
        model: LLM_MODELS.anthropic[LLM_MODELS.anthropic.length - 1].id,
        systemPrompt:
          'Summarize this conversation. Return ONLY valid JSON, no other text:\n{\n  "summary": "2-3 sentence summary focusing on decisions and outcomes",\n  "tags": ["3-5 retrieval keywords"],\n  "slug": "short-kebab-case-identifier"\n}',
        messages: [{ role: 'user', content: transcript }],
        tools: [],
      },
      () => {},
    );

    const text = result.textContent?.trim();
    if (!text) return;

    let parsed: { summary: string; tags: string[]; slug: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      // Fallback: treat entire response as summary
      parsed = { summary: text, tags: [], slug: sessionId.slice(0, 20) };
    }

    const date = new Date().toISOString().slice(0, 10);
    const slug = parsed.slug.replace(/[^a-z0-9-]/g, '').slice(0, 40) || sessionId.slice(0, 12);

    const ctx = createUICommandContext();
    await writeMemory(ctx, {
      action: 'create',
      type: 'episodic',
      name: `${date}-${slug}`,
      description: parsed.summary.slice(0, 100),
      content: parsed.summary,
      tags: parsed.tags,
    });
  } catch (e) {
    console.warn('[MemoryExtractor] Session summarization failed (non-blocking):', e);
  }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: May have errors from the prompt-assembler change (fixed in next task).

- [ ] **Step 3: Commit**

```bash
git add src/core/memory-extractor.ts
git commit -m "feat(memory-v2): episodic summaries as files with richer LLM output"
```

---

### Task 9: Wire Pipeline into Chat Session

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Replace flat memory loading with pipeline**

In `src/ui/hooks/useChatSession.ts`, update imports. Add:

```typescript
import { loadValidMemories } from '../../commands/memory-commands';
import { retrieveMemories } from '../../memory/pipeline';
import { createMetadataRetriever } from '../../memory/retrievers/metadata-retriever';
import { createRRFFuser } from '../../memory/fusers/rrf-fuser';
import { createAnnotatedFormatter } from '../../memory/formatters/annotated-formatter';
```

Remove the imports of `loadAllForPrompt` if present (it was imported via `memoryCommands`).

Find the memory loading section (around lines 164-166):

```typescript
      const memCtx = createUICommandContext();
      const semanticMemories = await memoryCommands.loadAllForPrompt(memCtx);
      const episodicSummaries = await memoryDb.getRecentEpisodic(3) as Array<{ summary: string }>;
```

Replace with:

```typescript
      const memCtx = createUICommandContext();
      const allMemories = await loadValidMemories(memCtx);

      // Retrieval pipeline
      const { formatted: memoryContext } = await retrieveMemories(
        input,
        allMemories,
        [createMetadataRetriever()],
        createRRFFuser(),
        createAnnotatedFormatter(),
        { topK: 10, charBudget: 2000 },
        memCtx,
      );

      // Recent episodic sessions (separate from retrieval — for temporal grounding)
      const episodicMemories = allMemories
        .filter((m) => m.type === 'episodic')
        .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
        .slice(0, 3);
```

Then update the `assembleSystemPrompt` call:

```typescript
      const systemPrompt = assembleSystemPrompt({
        globalInstructions,
        presetPrompt: activePreset?.prompt ?? null,
        presetName: activePreset?.name ?? null,
        memoryContext,
        recentSessionSummaries: episodicMemories.map((m) => ({
          summary: m.content,
          created_at: m.created_at,
        })),
      });
```

Remove the `memoryDb` import if it's no longer used for `getRecentEpisodic`. Check if `memoryDb` or `memory` from `db-client` is used elsewhere in the file — if `getRecentEpisodic` was the only usage, remove the import. If other DB memory functions are used, keep the import.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(memory-v2): wire retrieval pipeline into chat session"
```

---

### Task 10: Update Memory Settings UI

**Files:**
- Modify: `src/ui/components/settings/MemorySection.tsx`

- [ ] **Step 1: Show new fields in memory list and edit form**

In `src/ui/components/settings/MemorySection.tsx`, the component already reads from `memoryCommands.listMemories()`. Since `MemoryEntry` now has `tags`, `valid`, `access_count`, and `last_accessed`, update the UI:

1. In the memory list, show tags as small pills/chips after the description:

Find where each memory entry is rendered (look for `e.description` or similar). After the description text, add:

```tsx
{e.tags.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {e.tags.map((tag) => (
      <span key={tag} className="text-[9px] bg-zinc-700 text-zinc-400 rounded px-1 py-0.5">{tag}</span>
    ))}
  </div>
)}
```

2. Show superseded memories with a visual indicator. In the memory list item, add a condition:

```tsx
{!e.valid && (
  <span className="text-[9px] text-zinc-600 italic ml-2">superseded</span>
)}
```

3. Add `'episodic'` to the type dropdown if there's a type selector in the create form. Find the type options and add episodic.

4. In the create/edit form, add a tags input (comma-separated string that splits into array):

```tsx
<div>
  <label className="text-[10px] text-zinc-500 block mb-0.5">Tags (comma-separated)</label>
  <input
    type="text"
    value={tagsInput}
    onChange={(e) => setTagsInput(e.target.value)}
    placeholder="e.g., communication, preferences"
    className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
  />
</div>
```

With state: `const [tagsInput, setTagsInput] = useState('');`

When saving, convert: `tags: tagsInput.split(',').map(t => t.trim()).filter(Boolean)`

Read the file first to understand the current structure before making edits. The key changes are additive — show tags, show valid status, add tags input to the form.

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/settings/MemorySection.tsx
git commit -m "feat(memory-v2): show tags, validity, and episodic type in memory settings UI"
```

---

### Task 11: Build and Verify

**Files:** None — verification only.

- [ ] **Step 1: Build electron app**

Run: `npm run build:electron`
Expected: Build succeeds.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Manual verification checklist**

Run: `npx electron .`

Verify:
1. Settings → Model tab → Memory section shows existing memories with tags (empty `[]` for old ones)
2. Chat agent can create a memory with tags: "Remember that I prefer TypeScript" → agent calls `manage_memory` with tags
3. Chat agent can supersede a memory: "Actually, update that — I prefer Python now" → agent uses `supersedes`
4. Memory retrieval is query-relevant: ask "What do I prefer for coding?" → retriever scores language preference higher than unrelated memories
5. Prompt includes "Memory Guidelines" section
6. Session end creates an episodic file in `.kg/agent/memory/` with `type: episodic`
7. Episodic sessions show in "Recent Sessions" section of prompt

- [ ] **Step 4: Final commit if any fixes were needed**
