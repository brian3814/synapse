# Agent Harness Phase 1: Custom Prompts + Tool Registry

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add custom prompt support (global instructions + per-session presets) and refactor chat tools into an extensible registry, with one new tool (`index_notes_folder`) and quick-action buttons.

**Architecture:** DB-first approach following existing conventions. Config in chrome.storage (like `llmConfig`). Pure-function prompt assembler. Module-level tool registry replacing the hardcoded switch statement. No test framework configured — verification is TypeScript compilation + manual functional testing.

**Tech Stack:** TypeScript, React 19, Zustand, Vite, chrome.storage API, SQLite (wa-sqlite / better-sqlite3)

**Spec:** `docs/superpowers/specs/2026-05-03-agent-harness-design.md`

---

### Task 1: DB Migration — Create Memory Tables

**Files:**
- Create: `src/db/worker/migrations/008-agent-harness.ts`
- Modify: `src/db/worker/migrations/index.ts`

- [ ] **Step 1: Create migration file**

```ts
// src/db/worker/migrations/008-agent-harness.ts
export const version = 8;
export const description = 'Agent harness: memory tables and chat session preset column';

export const up = `
CREATE TABLE IF NOT EXISTS memory_semantic (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL DEFAULT 'fact',
  content TEXT NOT NULL,
  source_session_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_semantic_category ON memory_semantic(category);

CREATE TABLE IF NOT EXISTS memory_episodic (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  key_topics TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_memory_episodic_session ON memory_episodic(session_id);
`;
```

Note: `ALTER TABLE chat_sessions ADD COLUMN preset_id TEXT` cannot go here because `chat_sessions` is created via `CREATE TABLE IF NOT EXISTS` in `migrations/index.ts:124-129`, not via a numbered migration. We add the column in that same idempotent block instead.

- [ ] **Step 2: Register migration in index.ts**

In `src/db/worker/migrations/index.ts`, add the import and include it in the `migrations` array:

```ts
// Add after line 8:
import * as migration008 from './008-agent-harness';

// Change line 17 to include migration008:
const migrations: Migration[] = [migration001, migration002, migration003, migration004, migration005, migration006, migration007, migration008];
```

Also add the `preset_id` column to the idempotent `chat_sessions` block. Change the `CREATE TABLE IF NOT EXISTS chat_sessions` at line 124 to:

```sql
CREATE TABLE IF NOT EXISTS chat_sessions (
    id TEXT PRIMARY KEY, title TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
    status TEXT NOT NULL DEFAULT 'active',
    preset_id TEXT
);
```

Since this uses `IF NOT EXISTS`, existing databases won't re-create the table. For those, add an idempotent ALTER after line 137:

```ts
// After the CREATE INDEX for chat_messages (line 137), add:
try {
  await executeExec(`ALTER TABLE chat_sessions ADD COLUMN preset_id TEXT;`);
} catch {
  // Column already exists — expected on subsequent runs
}
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/db/worker/migrations/008-agent-harness.ts src/db/worker/migrations/index.ts
git commit -m "feat(db): add migration 008 for agent harness memory tables"
```

---

### Task 2: Tool Registry

**Files:**
- Create: `src/shared/chat-tool-registry.ts`

- [ ] **Step 1: Create the tool registry module**

```ts
// src/shared/chat-tool-registry.ts
import type { ChatToolDefinition } from './chat-agent-tools';
import { toAnthropicChatTools } from './chat-agent-tools';

export interface ChatToolRegistration {
  definition: ChatToolDefinition;
  executor: (input: Record<string, unknown>) => Promise<string>;
}

const registry = new Map<string, ChatToolRegistration>();

export function registerChatTool(tool: ChatToolRegistration): void {
  registry.set(tool.definition.name, tool);
}

export function getChatToolDefinitions(): ChatToolDefinition[] {
  return Array.from(registry.values()).map((t) => t.definition);
}

export function executeChatTool(
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  const tool = registry.get(name);
  if (!tool) return Promise.resolve(JSON.stringify({ error: `Unknown tool: ${name}` }));
  return tool.executor(input);
}

export function getAnthropicChatTools() {
  return toAnthropicChatTools(getChatToolDefinitions());
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/shared/chat-tool-registry.ts
git commit -m "feat(harness): add chat tool registry with register/execute/getDefinitions"
```

---

### Task 3: Extract Tool Executors from chat-agent-loop.ts

**Files:**
- Create: `src/core/chat-tool-executors.ts`

This extracts all 10 tool executor cases from the `executeTool()` switch statement in `src/ui/hooks/chat-agent-loop.ts:249-386` into standalone functions. Each function has the same signature: `(input: Record<string, unknown>) => Promise<string>`.

- [ ] **Step 1: Create chat-tool-executors.ts**

```ts
// src/core/chat-tool-executors.ts
import { nodes, edges, sourceContent } from '../db/client/db-client';
import { useGraphStore } from '../graph/store/graph-store';
import { retrieveRAGContext, formatRAGPrompt } from '../ui/hooks/rag-pipeline';
import { notes } from '@platform';
import { parseMarkdown } from '../notes/markdown-utils';

// RAG context tracking for subgraph visualization
let lastRAGNodeIds: string[] = [];
let lastRAGEdgeIds: string[] = [];

export function getLastRAGIds(): { nodeIds: string[]; edgeIds: string[] } {
  return { nodeIds: lastRAGNodeIds, edgeIds: lastRAGEdgeIds };
}

export async function executeSearchKnowledge(input: Record<string, unknown>): Promise<string> {
  const context = await retrieveRAGContext(input.query as string);
  lastRAGNodeIds = context.relevantNodes.map((n) => n.id);
  lastRAGEdgeIds = context.relevantEdges.map((e) => e.id);
  return formatRAGPrompt(context);
}

export async function executeSearchNodes(input: Record<string, unknown>): Promise<string> {
  const results = await nodes.search(input.query as string, (input.limit as number) ?? 10);
  return JSON.stringify(
    (results as any[]).map((n) => ({
      id: n.id,
      name: n.name,
      type: n.type,
      properties: typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties,
    })),
  );
}

export async function executeGetNodeDetails(input: Record<string, unknown>): Promise<string> {
  const node = await nodes.getById(input.nodeId as string);
  if (!node) return JSON.stringify({ error: 'Node not found' });
  return JSON.stringify({
    id: (node as any).id,
    name: (node as any).name,
    type: (node as any).type,
    properties:
      typeof (node as any).properties === 'string'
        ? JSON.parse((node as any).properties)
        : (node as any).properties,
    sourceUrl: (node as any).source_url,
  });
}

export async function executeGetNeighbors(input: Record<string, unknown>): Promise<string> {
  const result = await nodes.getNeighborhood(
    input.nodeId as string,
    Math.min((input.hops as number) ?? 1, 3),
  );
  const details = await Promise.all(
    (result as { nodeIds: string[] }).nodeIds.slice(0, 50).map((id: string) => nodes.getById(id)),
  );
  return JSON.stringify(
    details.filter(Boolean).map((n: any) => ({ id: n.id, name: n.name, type: n.type })),
  );
}

export async function executeGetEdgesForNode(input: Record<string, unknown>): Promise<string> {
  const edgeList = await edges.getForNode(input.nodeId as string);
  return JSON.stringify(
    (edgeList as any[]).map((e) => ({
      id: e.id,
      sourceId: e.source_id,
      targetId: e.target_id,
      label: e.label,
      type: e.type,
    })),
  );
}

export async function executeSearchSources(input: Record<string, unknown>): Promise<string> {
  const results = await sourceContent.search(input.query as string, (input.limit as number) ?? 5);
  return JSON.stringify(
    (results as any[]).map((s) => ({
      nodeId: s.node_id,
      url: s.url,
      title: s.title,
      excerpt: s.content?.substring(0, 500),
    })),
  );
}

export async function executeGetSourceContent(input: Record<string, unknown>): Promise<string> {
  const nodeId = input.nodeId as string;
  const targetNode = useGraphStore.getState().nodes.find((n) => n.id === nodeId);
  if (targetNode?.type === 'note') {
    const md = await notes.read(nodeId);
    if (md) {
      const parsed = parseMarkdown(md);
      return JSON.stringify({
        url: `note://${nodeId}`,
        title: targetNode.name,
        content: parsed.content.substring(0, 5000),
      });
    }
  }
  const sc = await sourceContent.getByNodeId(nodeId);
  if (!sc) return JSON.stringify({ error: 'No source content found' });
  return JSON.stringify({
    url: (sc as any).url,
    title: (sc as any).title,
    content: (sc as any).content?.substring(0, 5000),
  });
}

export async function executeCreateNode(input: Record<string, unknown>): Promise<string> {
  const graph = useGraphStore.getState();
  const created = await graph.createNode({
    name: input.name as string,
    type: input.type as string,
    properties: (input.properties as Record<string, unknown>) ?? {},
  });
  if (!created) return JSON.stringify({ error: 'Failed to create node' });
  return JSON.stringify({ id: created.id, name: created.name, type: created.type });
}

export async function executeUpdateNode(input: Record<string, unknown>): Promise<string> {
  const graph = useGraphStore.getState();
  const updated = await graph.updateNode({
    id: input.nodeId as string,
    name: input.name as string | undefined,
    type: input.type as string | undefined,
    properties: (input.properties as Record<string, unknown>) ?? undefined,
  });
  if (!updated) return JSON.stringify({ error: 'Failed to update node' });
  return JSON.stringify({ id: updated.id, name: updated.name });
}

export async function executeCreateEdge(input: Record<string, unknown>): Promise<string> {
  const graph = useGraphStore.getState();
  const created = await graph.createEdge({
    sourceId: input.sourceId as string,
    targetId: input.targetId as string,
    label: input.label as string,
    type: (input.type as string) ?? 'related',
  });
  if (!created) return JSON.stringify({ error: 'Failed to create edge' });
  return JSON.stringify({ id: created.id, label: created.label });
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/chat-tool-executors.ts
git commit -m "refactor(chat): extract tool executor functions from chat-agent-loop"
```

---

### Task 4: Index Notes Folder Tool

**Files:**
- Create: `src/core/harness-tools/index-notes-tool.ts`

- [ ] **Step 1: Create the index-notes tool**

```ts
// src/core/harness-tools/index-notes-tool.ts
import type { ChatToolRegistration } from '../../shared/chat-tool-registry';
import { getStoredFolder, requestPermission } from '../../filesystem/folder-access';
import { indexMarkdownFolder } from '../../filesystem/indexing-pipeline';
import { useGraphStore } from '../../graph/store/graph-store';

export function createIndexNotesTool(): ChatToolRegistration {
  return {
    definition: {
      name: 'index_notes_folder',
      description:
        'Index or re-index the connected markdown notes folder into the knowledge graph. Creates resource nodes for each .md file and edges for wiki-links. Returns indexing statistics.',
      parameters: {
        type: 'object',
        properties: {},
        required: [],
      },
      executionContext: 'ui',
    },
    executor: async () => {
      const handle = await getStoredFolder();
      if (!handle) {
        return JSON.stringify({
          error: 'No folder connected. Connect one in Settings > Markdown Folder.',
        });
      }

      const perm = await (handle as any).queryPermission({ mode: 'readwrite' });
      if (perm !== 'granted') {
        const granted = await requestPermission(handle);
        if (!granted) {
          return JSON.stringify({
            error: 'Permission denied. Please grant folder access in Settings.',
          });
        }
      }

      const result = await indexMarkdownFolder(handle);
      await useGraphStore.getState().loadAll();

      return JSON.stringify({
        processed: result.processed,
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
      });
    },
  };
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/harness-tools/index-notes-tool.ts
git commit -m "feat(harness): add index_notes_folder chat tool"
```

---

### Task 5: Harness Init — Wire Up Registry

**Files:**
- Create: `src/core/harness-init.ts`

This file registers all built-in chat tools + the new harness tools into the registry. Called once at app startup.

- [ ] **Step 1: Create harness-init.ts**

```ts
// src/core/harness-init.ts
import { CHAT_AGENT_TOOLS } from '../shared/chat-agent-tools';
import { registerChatTool } from '../shared/chat-tool-registry';
import {
  executeSearchKnowledge,
  executeSearchNodes,
  executeGetNodeDetails,
  executeGetNeighbors,
  executeGetEdgesForNode,
  executeSearchSources,
  executeGetSourceContent,
  executeCreateNode,
  executeUpdateNode,
  executeCreateEdge,
} from './chat-tool-executors';
import { createIndexNotesTool } from './harness-tools/index-notes-tool';

const builtinExecutors: Record<string, (input: Record<string, unknown>) => Promise<string>> = {
  search_knowledge: executeSearchKnowledge,
  search_nodes: executeSearchNodes,
  get_node_details: executeGetNodeDetails,
  get_neighbors: executeGetNeighbors,
  get_edges_for_node: executeGetEdgesForNode,
  search_sources: executeSearchSources,
  get_source_content: executeGetSourceContent,
  create_node: executeCreateNode,
  update_node: executeUpdateNode,
  create_edge: executeCreateEdge,
};

let initialized = false;

export function initHarness(): void {
  if (initialized) return;
  initialized = true;

  for (const toolDef of CHAT_AGENT_TOOLS) {
    const executor = builtinExecutors[toolDef.name];
    if (executor) {
      registerChatTool({ definition: toolDef, executor });
    }
  }

  registerChatTool(createIndexNotesTool());
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/harness-init.ts
git commit -m "feat(harness): add harness-init that registers all chat tools"
```

---

### Task 6: Prompt Assembler

**Files:**
- Create: `src/core/prompt-assembler.ts`

- [ ] **Step 1: Create prompt-assembler.ts**

Move the `CHAT_AGENT_SYSTEM_PROMPT` constant from `chat-agent-loop.ts:29-64` here as `BASE_CHAT_SYSTEM_PROMPT`, and add the assembly function.

```ts
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

export interface PromptContext {
  globalInstructions: string | null;
  presetPrompt: string | null;
  presetName: string | null;
  semanticMemories: Array<{ category: string; content: string }>;
  recentSessionSummaries: Array<{ summary: string }>;
}

export function assembleSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [BASE_CHAT_SYSTEM_PROMPT];

  if (ctx.globalInstructions) {
    sections.push(`## Custom Instructions\n${ctx.globalInstructions}`);
  }

  if (ctx.presetPrompt) {
    sections.push(`## Session Mode: ${ctx.presetName ?? 'Custom'}\n${ctx.presetPrompt}`);
  }

  if (ctx.semanticMemories.length > 0) {
    const lines = ctx.semanticMemories.map((m) => `- [${m.category}] ${m.content}`);
    sections.push(`## What I Know About You\n${lines.join('\n')}`);
  }

  if (ctx.recentSessionSummaries.length > 0) {
    const lines = ctx.recentSessionSummaries.map((s) => `- ${s.summary}`);
    sections.push(`## Recent Context\n${lines.join('\n')}`);
  }

  return sections.join('\n\n');
}
```

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```
git add src/core/prompt-assembler.ts
git commit -m "feat(harness): add pure-function prompt assembler with layered context"
```

---

### Task 7: Refactor chat-agent-loop.ts to Use Registry + Prompt Param

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`

This is the core wiring task. Three changes: (1) accept `systemPrompt` param instead of using the hardcoded constant, (2) use registry for tool definitions, (3) use registry for tool execution.

- [ ] **Step 1: Update imports and remove old constant**

At the top of `src/ui/hooks/chat-agent-loop.ts`, replace lines 1-66:

Replace:
```ts
import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
```
With:
```ts
import { getAnthropicChatTools, executeChatTool } from '../../shared/chat-tool-registry';
import { getLastRAGIds } from '../../core/chat-tool-executors';
```

Remove the entire `CHAT_AGENT_SYSTEM_PROMPT` constant (lines 29-64) and its export (line 66).

Remove these two lines (no longer needed since tools come from registry):
```ts
const TOOL_DEFS = toAnthropicChatTools(CHAT_AGENT_TOOLS);
```

- [ ] **Step 2: Add systemPrompt to RunChatAgentParams**

Change the `RunChatAgentParams` interface at line 72 to add `systemPrompt`:

```ts
interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  provider: string;
  model: string;
  systemPrompt: string;
  onProgress: (event: ChatAgentProgress) => void;
}
```

- [ ] **Step 3: Use dynamic tools and systemPrompt in runChatAgent**

In the `runChatAgent` function, destructure the new param:

```ts
export async function runChatAgent({
  conversationHistory,
  currentPrompt,
  provider,
  model,
  systemPrompt,
  onProgress,
}: RunChatAgentParams): Promise<string> {
```

In the `sendChatLLMRequest` call (around line 103-113), replace `CHAT_AGENT_SYSTEM_PROMPT` with `systemPrompt` and `TOOL_DEFS` with `getAnthropicChatTools()`:

```ts
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt,
        messages,
        tools: getAnthropicChatTools(),
      },
      onProgress,
    );
```

- [ ] **Step 4: Replace executeTool switch with registry call**

Replace the `executeTool` call at line 162:

```ts
        resultStr = await executeChatTool(tc.name, tc.input);
```

Update the `collectIdsFromToolResult` function to use `getLastRAGIds()` instead of the module-level variables. In the `search_knowledge` case of `collectIdsFromToolResult`, change:

```ts
    if (toolName === 'search_knowledge') {
      const ragIds = getLastRAGIds();
      for (const id of ragIds.nodeIds) nodeIds.add(id);
      for (const id of ragIds.edgeIds) edgeIds.add(id);
      return;
    }
```

- [ ] **Step 5: Remove the old executeTool function and RAG ID variables**

Delete the `executeTool` function (lines 249-386) and the `lastRAGNodeIds`/`lastRAGEdgeIds` variables (lines 246-247) — both are now in `chat-tool-executors.ts`.

- [ ] **Step 6: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```
git add src/ui/hooks/chat-agent-loop.ts
git commit -m "refactor(chat): wire chat-agent-loop to tool registry and accept systemPrompt param"
```

---

### Task 8: Wire Prompt Assembly into useChatSession

**Files:**
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Add imports and prompt assembly call**

Add imports at the top of `src/ui/hooks/useChatSession.ts`:

```ts
import { storage } from '@platform';
import { assembleSystemPrompt } from '../../core/prompt-assembler';
```

- [ ] **Step 2: Gather context and pass systemPrompt to runChatAgent**

In the `sendMessage` callback, after the `fetchLLMConfigAndTypes()` call (line 111) and before the `runChatAgent` call (line 116), add prompt assembly:

```ts
      const { config } = await fetchLLMConfigAndTypes();

      // Assemble system prompt with harness context
      const storageData = await storage.get(['harnessGlobalInstructions', 'harnessPresets', 'harnessActivePresetId']);
      const globalInstructions = (storageData as any).harnessGlobalInstructions ?? null;
      const presets = (storageData as any).harnessPresets ?? [];
      const activePresetId = (storageData as any).harnessActivePresetId ?? null;
      const activePreset = activePresetId
        ? presets.find((p: any) => p.id === activePresetId)
        : null;

      const systemPrompt = assembleSystemPrompt({
        globalInstructions,
        presetPrompt: activePreset?.prompt ?? null,
        presetName: activePreset?.name ?? null,
        semanticMemories: [],
        recentSessionSummaries: [],
      });
```

Then add `systemPrompt` to the `runChatAgent` call:

```ts
      const finalText = await runChatAgent({
        conversationHistory: historyForLLM,
        currentPrompt: input,
        provider: config.provider,
        model: config.model,
        systemPrompt,
        onProgress: (event: ChatAgentProgress) => {
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(harness): wire prompt assembler into useChatSession"
```

---

### Task 9: Call initHarness from App.tsx

**Files:**
- Modify: `src/ui/App.tsx`

- [ ] **Step 1: Import and call initHarness**

Add import at the top:

```ts
import { initHarness } from '../core/harness-init';
```

In the `ready` useEffect (lines 53-64), call `initHarness()` before `loadAll()`:

```ts
  useEffect(() => {
    if (ready) {
      initHarness();
      loadAll();
      loadTypes();
      const cleanupSync = startSyncListener();
      const cleanupQuery = registerQueryMessageHandler();
      return () => {
        cleanupSync();
        cleanupQuery();
      };
    }
  }, [ready, loadAll, loadTypes, startSyncListener]);
```

- [ ] **Step 2: Verify full build**

Run: `npm run build && npm run build:electron 2>&1 | tail -5`
Expected: both builds succeed

- [ ] **Step 3: Commit**

```
git add src/ui/App.tsx
git commit -m "feat(harness): call initHarness on app startup"
```

---

### Task 10: Custom Instructions UI in Settings

**Files:**
- Create: `src/ui/components/settings/CustomInstructionsSection.tsx`
- Modify: `src/ui/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Create CustomInstructionsSection component**

```tsx
// src/ui/components/settings/CustomInstructionsSection.tsx
import { useState, useEffect } from 'react';
import { storage } from '@platform';

export function CustomInstructionsSection() {
  const [instructions, setInstructions] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    storage.get('harnessGlobalInstructions').then((result: Record<string, any>) => {
      if (result.harnessGlobalInstructions) {
        setInstructions(result.harnessGlobalInstructions);
      }
    }).catch(() => {});
  }, []);

  const handleSave = async () => {
    try {
      await storage.set({ harnessGlobalInstructions: instructions });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      console.error('Failed to save custom instructions:', e);
    }
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <h4 className="text-xs font-medium text-zinc-400 mb-2">Custom Instructions</h4>
      <p className="text-[10px] text-zinc-600 mb-2">
        These instructions apply to every chat session. Tell the agent about your preferences, role, or how you want responses formatted.
      </p>
      <textarea
        value={instructions}
        onChange={(e) => setInstructions(e.target.value)}
        placeholder="e.g., I'm a researcher in AI safety. Always cite sources. Respond in bullet points."
        rows={4}
        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
      />
      <button
        onClick={handleSave}
        className="mt-2 w-full bg-indigo-600 text-white text-sm py-1.5 rounded hover:bg-indigo-500 transition-colors"
      >
        {saved ? 'Saved!' : 'Save Instructions'}
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Add to SettingsPanel**

In `src/ui/components/settings/SettingsPanel.tsx`, add the import:

```ts
import { CustomInstructionsSection } from './CustomInstructionsSection';
```

Add `<CustomInstructionsSection />` after the save/clear buttons block (after line 118) and before `<UsageSection />` (line 120):

```tsx
      </div>

      <CustomInstructionsSection />

      <UsageSection />
```

- [ ] **Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Commit**

```
git add src/ui/components/settings/CustomInstructionsSection.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(harness): add Custom Instructions section to Settings"
```

---

### Task 11: Preset Picker UI

**Files:**
- Create: `src/ui/components/chat/PresetPicker.tsx`
- Modify: `src/ui/components/chat/ChatBot.tsx`

- [ ] **Step 1: Create PresetPicker component**

```tsx
// src/ui/components/chat/PresetPicker.tsx
import { useState, useEffect, useRef } from 'react';
import { storage } from '@platform';

interface Preset {
  id: string;
  name: string;
  prompt: string;
  allowedTools: string[] | null;
  model: string | null;
  createdAt: number;
}

export function PresetPicker() {
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPrompt, setNewPrompt] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    storage.get(['harnessPresets', 'harnessActivePresetId']).then((result: Record<string, any>) => {
      if (result.harnessPresets) setPresets(result.harnessPresets);
      if (result.harnessActivePresetId) setActiveId(result.harnessActivePresetId);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const activeName = activeId ? presets.find((p) => p.id === activeId)?.name : null;

  const selectPreset = async (id: string | null) => {
    setActiveId(id);
    setOpen(false);
    try {
      await storage.set({ harnessActivePresetId: id });
    } catch {}
  };

  const createPreset = async () => {
    if (!newName.trim() || !newPrompt.trim()) return;
    const preset: Preset = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      prompt: newPrompt.trim(),
      allowedTools: null,
      model: null,
      createdAt: Date.now(),
    };
    const updated = [...presets, preset];
    setPresets(updated);
    setActiveId(preset.id);
    setCreating(false);
    setNewName('');
    setNewPrompt('');
    try {
      await storage.set({ harnessPresets: updated, harnessActivePresetId: preset.id });
    } catch {}
  };

  const deletePreset = async (id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    if (activeId === id) {
      setActiveId(null);
      await storage.set({ harnessPresets: updated, harnessActivePresetId: null }).catch(() => {});
    } else {
      await storage.set({ harnessPresets: updated }).catch(() => {});
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        title="Select session preset"
      >
        <span>{activeName ?? 'Default'}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          <button
            onClick={() => selectPreset(null)}
            className={`w-full text-left px-3 py-2 text-xs transition-colors ${
              !activeId ? 'bg-indigo-600/20 text-indigo-300' : 'text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            Default
          </button>

          {presets.map((p) => (
            <div
              key={p.id}
              className={`flex items-center justify-between px-3 py-2 transition-colors ${
                activeId === p.id ? 'bg-indigo-600/20' : 'hover:bg-zinc-700'
              }`}
            >
              <button
                onClick={() => selectPreset(p.id)}
                className={`text-xs text-left flex-1 truncate ${
                  activeId === p.id ? 'text-indigo-300' : 'text-zinc-300'
                }`}
              >
                {p.name}
              </button>
              <button
                onClick={() => deletePreset(p.id)}
                className="text-zinc-500 hover:text-red-400 ml-2 p-0.5"
                title="Delete preset"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}

          {creating ? (
            <div className="p-3 border-t border-zinc-700 space-y-2">
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Preset name"
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                autoFocus
              />
              <textarea
                value={newPrompt}
                onChange={(e) => setNewPrompt(e.target.value)}
                placeholder="Instructions for this mode..."
                rows={3}
                className="w-full bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={createPreset}
                  disabled={!newName.trim() || !newPrompt.trim()}
                  className="flex-1 bg-indigo-600 text-white text-xs py-1 rounded hover:bg-indigo-500 disabled:opacity-40"
                >
                  Save
                </button>
                <button
                  onClick={() => { setCreating(false); setNewName(''); setNewPrompt(''); }}
                  className="flex-1 bg-zinc-700 text-zinc-300 text-xs py-1 rounded hover:bg-zinc-600"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-zinc-700 border-t border-zinc-700 transition-colors"
            >
              + New preset
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add PresetPicker and quick-action chips to ChatBot**

In `src/ui/components/chat/ChatBot.tsx`:

Add import at top:
```ts
import { PresetPicker } from './PresetPicker';
```

In the `ChatHeader` component, add `<PresetPicker />` next to the session title. Insert after the `SessionPicker` closing tag (around line 155), inside the `<div className="relative flex items-center gap-1 ...">`:

```tsx
        <PresetPicker />
```

Replace the `SUGGESTION_CHIPS` constant (lines 178-182) with:

```ts
interface QuickAction {
  label: string;
  prompt: string;
  partial?: boolean;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Index my notes', prompt: 'Please index my notes folder now.' },
  { label: 'Find duplicates', prompt: 'Find potential duplicate entities in my graph.' },
  { label: 'What do I know about...', prompt: 'What do I know about ', partial: true },
  { label: 'Summarize recent pages', prompt: 'Summarize the pages I\'ve recently extracted.' },
  { label: 'Find connections', prompt: 'Find connections between ', partial: true },
];
```

In the `ChatMessages` component, update the chip rendering (lines 204-213) to use `QUICK_ACTIONS`:

```tsx
          <div className="flex flex-wrap gap-2 justify-center">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => onSuggestionClick(action.prompt)}
                className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-full hover:border-indigo-500/50 hover:text-zinc-200 transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
```

- [ ] **Step 3: Verify full build**

Run: `npm run build && npm run build:electron 2>&1 | tail -5`
Expected: both builds succeed

- [ ] **Step 4: Commit**

```
git add src/ui/components/chat/PresetPicker.tsx src/ui/components/chat/ChatBot.tsx
git commit -m "feat(harness): add PresetPicker and quick-action chips to chat UI"
```

---

### Task 12: Final Verification

- [ ] **Step 1: Full build verification**

Run: `npm run build && npm run build:electron`
Expected: both builds succeed with no errors

- [ ] **Step 2: Manual functional test (Electron)**

Run: `npx electron .`

1. Open Settings → verify "Custom Instructions" section appears with textarea
2. Type instructions, click Save, reload → instructions persist
3. Open Chat → verify PresetPicker dropdown appears in header
4. Create a preset → verify it appears in the dropdown
5. Select the preset, send a message → verify agent response reflects the preset instructions
6. Verify quick-action chips appear in empty chat state
7. Click "Index my notes" chip → verify it pre-fills the input
8. Send "Index my notes folder" → verify the tool executes (may require a folder connected)
9. Verify existing chat tools (search, create node, etc.) still work

- [ ] **Step 3: Manual functional test (Chrome)**

Load `dist/` as unpacked extension. Repeat steps 1-9 above in the tab view.
