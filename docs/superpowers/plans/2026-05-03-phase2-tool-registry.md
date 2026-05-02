# Phase 2: Tool Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded tool arrays (`AGENT_TOOLS`, `CHAT_AGENT_TOOLS`) with a dynamic `ToolRegistry` that supports registration, filtering, and dispatch. This enables future MCP servers, plugins, and custom user tools to register tools at runtime without touching core agent loops.

**Architecture:** A singleton `ToolRegistry` holds `UnifiedToolDefinition` objects keyed by name. Built-in tools are registered at app startup via `registerBuiltinTools()`. Each tool optionally carries an `execute` function (for tools that can run in the current context). A `ToolDispatcher` adapts the registry into the existing `ToolExecutor` interface consumed by `src/core/agent-loop.ts`. System prompts are generated dynamically from registered tool metadata.

**Tech Stack:** TypeScript, existing `CommandContext` from Phase 1, existing `ToolExecutor` interface from `src/core/agent-loop.ts`

**Depends on:** Phase 1 (Command Layer) complete -- `src/commands/types.ts` (`CommandContext`), `src/commands/graph-commands.ts`, `src/commands/chat-tool-executor.ts`, `src/commands/rag-commands.ts`, `src/commands/create-context.ts`

**No test framework configured.** Verification = `npm run build` + `npm run build:electron` clean.

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/tools/types.ts` | `UnifiedToolDefinition`, `ToolCategory`, `ToolFilter` types |
| `src/tools/registry.ts` | `ToolRegistry` class with register/unregister/query/snapshot; singleton `toolRegistry` export |
| `src/tools/builtin/extraction-tools.ts` | Registers the 9 extraction tools from `agent-tools.ts` |
| `src/tools/builtin/chat-tools.ts` | Registers the 10 chat tools from `chat-agent-tools.ts` with `execute` wrappers |
| `src/tools/builtin/graph-tools.ts` | New MCP-friendly graph tools (`kg_create_node`, `kg_update_node`, etc.) wrapping graph-commands |
| `src/tools/builtin/index.ts` | `registerBuiltinTools(registry)` that calls all three registration modules |
| `src/tools/dispatcher.ts` | `ToolDispatcher` implementing `ToolExecutor` interface from `src/core/agent-loop.ts` |
| `src/tools/prompt-builder.ts` | `buildToolSystemPrompt(registry, category, options?)` for dynamic prompt generation |
| `src/tools/index.ts` | Barrel export |

### Modified files

| File | Change |
|------|--------|
| `src/core/agent-loop.ts` | Accept tools + system prompt as parameters instead of importing hardcoded arrays |
| `src/offscreen/agent-loop.ts` | Use `ToolDispatcher` instead of `ContentScriptToolExecutor` for `fetch_url`/`save_entities`; content-script tools still dispatched via chrome.runtime message |
| `electron/llm-backend.ts` | Use `ToolDispatcher` instead of inline switch for tool dispatch in `handleAgentRun` and `handleRunAgent` |
| `src/ui/hooks/chat-agent-loop.ts` | Use registry for tool definitions instead of importing `CHAT_AGENT_TOOLS` |

---

### Task 1: Unified tool types

**Files:**
- Create: `src/tools/types.ts`

- [ ] **Step 1: Create types file**

```typescript
// src/tools/types.ts
import type { CommandContext } from '../commands/types';

/**
 * Tool categories determine which agent loops a tool is available in.
 * - extraction: page analysis + entity extraction (agent loop)
 * - chat: knowledge graph querying + modification (chat agent loop)
 * - graph: direct KG CRUD for MCP/plugin callers
 * - custom: user-registered or plugin-provided tools
 */
export type ToolCategory = 'extraction' | 'chat' | 'graph' | 'custom';

/**
 * Where the tool's execute function runs. Used by dispatchers to route
 * execution to the right context.
 * - local: execute() can run in the current JS context (offscreen, main, UI)
 * - content-script: must be dispatched to a content script via platform messaging
 */
export type ToolExecutionTarget = 'local' | 'content-script';

/**
 * Unified tool definition that replaces both ToolDefinition (agent-tools.ts)
 * and ChatToolDefinition (chat-agent-tools.ts).
 */
export interface UnifiedToolDefinition {
  /** Unique tool name (e.g. 'get_page_content', 'search_knowledge') */
  name: string;
  /** Human-readable description shown to the LLM */
  description: string;
  /** JSON Schema for the tool's input parameters */
  parameters: Record<string, unknown>;
  /** Which agent loop(s) this tool belongs to */
  category: ToolCategory;
  /** Where the tool executes — determines dispatch strategy */
  executionTarget: ToolExecutionTarget;
  /**
   * Optional execute function. Tools with executionTarget='content-script'
   * typically omit this (dispatched by platform). Tools with
   * executionTarget='local' should provide it.
   */
  execute?: (input: Record<string, unknown>, ctx: CommandContext) => Promise<string>;
  /**
   * If true, this tool is terminal — the agent loop should stop after
   * receiving its result (e.g. save_entities).
   */
  terminal?: boolean;
}

/**
 * Filter criteria for querying the registry.
 */
export interface ToolFilter {
  /** Match tools in this category */
  category?: ToolCategory;
  /** Match tools in any of these categories */
  categories?: ToolCategory[];
  /** Match tools with this execution target */
  executionTarget?: ToolExecutionTarget;
  /** Match tools by name (exact match, useful for checking existence) */
  name?: string;
  /** Allowlist: only return tools whose names are in this set. Used by preset allowedTools. */
  allowedNames?: string[];
}

/**
 * Anthropic API tool format — what gets sent to the Claude API.
 */
export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds (new file has no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/tools/types.ts
git commit -m "feat(tools): add UnifiedToolDefinition and ToolFilter types"
```

---

### Task 2: Tool registry

**Files:**
- Create: `src/tools/registry.ts`

- [ ] **Step 1: Create registry class**

```typescript
// src/tools/registry.ts
import type { UnifiedToolDefinition, ToolFilter, AnthropicTool } from './types';

/**
 * Dynamic tool registry. Tools register at startup (built-ins) or at runtime
 * (plugins, MCP servers). The registry is the single source of truth for
 * which tools are available — agent loops and dispatchers query it.
 */
export class ToolRegistry {
  private tools = new Map<string, UnifiedToolDefinition>();

  /**
   * Register a tool. Throws if a tool with the same name already exists
   * (use unregister first to replace).
   */
  register(tool: UnifiedToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  /**
   * Register multiple tools at once. Throws on first duplicate.
   */
  registerAll(tools: UnifiedToolDefinition[]): void {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Remove a tool by name. Returns true if the tool existed.
   */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /**
   * Get a tool by exact name, or undefined if not found.
   */
  get(name: string): UnifiedToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Check if a tool exists by name.
   */
  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * List all tools, optionally filtered.
   */
  list(filter?: ToolFilter): UnifiedToolDefinition[] {
    let results = Array.from(this.tools.values());

    if (filter?.name) {
      results = results.filter((t) => t.name === filter.name);
    }
    if (filter?.category) {
      results = results.filter((t) => t.category === filter.category);
    }
    if (filter?.categories && filter.categories.length > 0) {
      const cats = new Set(filter.categories);
      results = results.filter((t) => cats.has(t.category));
    }
    if (filter?.executionTarget) {
      results = results.filter((t) => t.executionTarget === filter.executionTarget);
    }
    if (filter?.allowedNames && filter.allowedNames.length > 0) {
      const allowed = new Set(filter.allowedNames);
      results = results.filter((t) => allowed.has(t.name));
    }

    return results;
  }

  /**
   * Convert filtered tools to Anthropic API format.
   */
  toAnthropicTools(filter?: ToolFilter): AnthropicTool[] {
    return this.list(filter).map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters,
    }));
  }

  /**
   * Get a serializable snapshot of all registered tools (for debugging,
   * logging, or sending to other contexts).
   */
  snapshot(): Array<{ name: string; category: string; executionTarget: string; terminal: boolean }> {
    return Array.from(this.tools.values()).map((t) => ({
      name: t.name,
      category: t.category,
      executionTarget: t.executionTarget,
      terminal: t.terminal ?? false,
    }));
  }

  /**
   * Remove all tools. Useful for testing or full reset.
   */
  clear(): void {
    this.tools.clear();
  }

  /**
   * Number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }
}

/** Singleton registry instance — import this in app code. */
export const toolRegistry = new ToolRegistry();
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/registry.ts
git commit -m "feat(tools): add ToolRegistry class with filter/query/snapshot support"
```

---

### Task 3: Built-in extraction tools

**Files:**
- Create: `src/tools/builtin/extraction-tools.ts`

This migrates the 9 tools from `src/shared/agent-tools.ts` into `UnifiedToolDefinition` format. Seven content-script tools have `executionTarget: 'content-script'` and no `execute`. `fetch_url` and `save_entities` have `executionTarget: 'local'` with `execute` functions.

- [ ] **Step 1: Create extraction-tools.ts**

```typescript
// src/tools/builtin/extraction-tools.ts
import type { ToolRegistry } from '../registry';
import type { UnifiedToolDefinition } from '../types';
import type { CommandContext } from '../../commands/types';

/**
 * fetch_url execute implementation.
 * Works in both offscreen (Chrome) and main process (Electron) contexts.
 * Content fetching is done via global fetch + HTML-to-markdown.
 * The actual fetch logic is injected by the dispatcher since it differs
 * by platform (offscreen has fetchAndCleanContent, electron has its own).
 * This execute returns a placeholder — platform dispatchers override it.
 */
async function executeFetchUrl(
  input: Record<string, unknown>,
  _ctx: CommandContext,
): Promise<string> {
  // This is a default implementation using global fetch.
  // Platform-specific dispatchers (Chrome offscreen, Electron main) may
  // override this with their own fetchAndCleanContent that includes
  // URL blocking and HTML-to-markdown conversion.
  const url = input.url as string;
  if (!url) return JSON.stringify({ error: 'No URL provided' });
  try {
    const response = await fetch(url);
    if (!response.ok) return JSON.stringify({ error: `HTTP ${response.status}` });
    const text = await response.text();
    return text.substring(0, 20_000);
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}

/**
 * save_entities is terminal — the agent loop intercepts it before execute
 * runs. This execute is a no-op fallback that should never be called.
 */
async function executeSaveEntities(
  input: Record<string, unknown>,
  _ctx: CommandContext,
): Promise<string> {
  return JSON.stringify(input);
}

const EXTRACTION_TOOLS: UnifiedToolDefinition[] = [
  {
    name: 'get_page_content',
    description:
      'Get the cleaned content of the current page. Returns markdown by default (preserving headings, links, tables, lists) or plain text. Navigation, scripts, and styling are removed.',
    parameters: {
      type: 'object',
      properties: {
        format: {
          type: 'string',
          enum: ['markdown', 'text'],
          description: 'Output format. "markdown" (default) preserves document structure; "text" returns plain text.',
        },
      },
      required: [],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'get_page_metadata',
    description:
      'Get metadata about the current page: title, URL, meta description, Open Graph tags, JSON-LD structured data, and heading outline (h1-h3).',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'query_selector',
    description:
      'Get the text content of the first element matching a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to match',
        },
      },
      required: ['selector'],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'query_selector_all',
    description:
      'Get the text content of all elements matching a CSS selector (max 50 results).',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector to match',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 50)',
        },
      },
      required: ['selector'],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'get_links',
    description:
      'Get all links on the page with their text and href. Optionally scope to a CSS selector.',
    parameters: {
      type: 'object',
      properties: {
        scope: {
          type: 'string',
          description: 'Optional CSS selector to scope link extraction',
        },
      },
      required: [],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'get_tables',
    description:
      'Extract HTML tables as arrays of row objects (header-keyed). Returns up to 5 tables with max 100 rows each.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'Optional CSS selector to target specific tables',
        },
      },
      required: [],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'get_structured_data',
    description:
      'Extract JSON-LD and microdata structured data from the page.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    category: 'extraction',
    executionTarget: 'content-script',
  },
  {
    name: 'fetch_url',
    description:
      'Fetch an external URL and return its content as markdown (max 20KB). Preserves headings, links, tables, and lists. Useful for reading linked pages referenced on the current page.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The URL to fetch',
        },
      },
      required: ['url'],
    },
    category: 'extraction',
    executionTarget: 'local',
    execute: executeFetchUrl,
  },
  {
    name: 'save_entities',
    description:
      'Save extracted entities and relationships to the knowledge graph. This is the terminal tool — call it when extraction is complete. Nodes must have name and type. Edges reference nodes by sourceName and targetName.',
    parameters: {
      type: 'object',
      properties: {
        nodes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Entity name' },
              type: { type: 'string', description: 'Entity type (e.g. person, company, concept)' },
              properties: {
                type: 'object',
                description: 'Optional key-value properties',
              },
              tags: { type: 'array', items: { type: 'string' }, description: 'Domain tags (e.g. technology, psychology)' },
            },
            required: ['name', 'type'],
          },
          description: 'Entities to save',
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              sourceName: { type: 'string', description: 'Source entity name' },
              targetName: { type: 'string', description: 'Target entity name' },
              label: { type: 'string', description: 'Relationship label (e.g. works_at, located_in)' },
              type: { type: 'string', description: 'Relationship category' },
            },
            required: ['sourceName', 'targetName', 'label'],
          },
          description: 'Relationships between entities',
        },
      },
      required: ['nodes', 'edges'],
    },
    category: 'extraction',
    executionTarget: 'local',
    execute: executeSaveEntities,
    terminal: true,
  },
];

/**
 * Register all extraction tools into the registry.
 */
export function registerExtractionTools(registry: ToolRegistry): void {
  registry.registerAll(EXTRACTION_TOOLS);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/extraction-tools.ts
git commit -m "feat(tools): register 9 extraction tools as UnifiedToolDefinitions"
```

---

### Task 4: Built-in chat tools

**Files:**
- Create: `src/tools/builtin/chat-tools.ts`

This migrates the 10 tools from `src/shared/chat-agent-tools.ts` into `UnifiedToolDefinition` format. Each tool gets an `execute` function that wraps the logic from Phase 1's `src/commands/chat-tool-executor.ts`.

- [ ] **Step 1: Create chat-tools.ts**

```typescript
// src/tools/builtin/chat-tools.ts
import type { ToolRegistry } from '../registry';
import type { UnifiedToolDefinition } from '../types';
import type { CommandContext } from '../../commands/types';
import { executeTool as chatExecuteTool } from '../../commands/chat-tool-executor';

/**
 * Wrap the Phase 1 chat-tool-executor dispatch into an execute function.
 * Each chat tool delegates to the centralized executeTool(ctx, name, input).
 */
function makeChatExecute(toolName: string) {
  return async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
    const execResult = await chatExecuteTool(ctx, toolName, input);
    return execResult.result;
  };
}

const CHAT_TOOLS: UnifiedToolDefinition[] = [
  {
    name: 'search_knowledge',
    description:
      'Search the knowledge graph comprehensively. Finds entities by name, expands to connected neighbors (1-hop graph traversal), and retrieves stored source content with URLs. This is the recommended FIRST tool for any question about what the user knows. Returns entities with IDs, relationships, and source excerpts with URLs for citation.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query — use key terms from the user\'s question',
        },
      },
      required: ['query'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('search_knowledge'),
  },
  {
    name: 'search_nodes',
    description:
      'Search the knowledge graph for nodes matching a query. Uses full-text search. Returns matching nodes with their type, properties, and ID.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 10)',
        },
      },
      required: ['query'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('search_nodes'),
  },
  {
    name: 'get_node_details',
    description:
      'Get full details of a specific node by ID, including all properties, type, and source URL.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node to retrieve',
        },
      },
      required: ['nodeId'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('get_node_details'),
  },
  {
    name: 'get_neighbors',
    description:
      'Get nodes connected to a given node within a specified number of hops.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the starting node',
        },
        hops: {
          type: 'number',
          description: 'Number of hops to traverse (default 1, max 3)',
        },
      },
      required: ['nodeId'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('get_neighbors'),
  },
  {
    name: 'get_edges_for_node',
    description:
      'Get all edges connected to a node, with their labels, types, and source/target IDs.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node',
        },
      },
      required: ['nodeId'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('get_edges_for_node'),
  },
  {
    name: 'search_sources',
    description:
      'Search stored source content (web page text) for passages matching a query.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return (default 5)',
        },
      },
      required: ['query'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('search_sources'),
  },
  {
    name: 'get_source_content',
    description:
      'Get the stored source text for a specific node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node whose source content to retrieve',
        },
      },
      required: ['nodeId'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('get_source_content'),
  },
  {
    name: 'create_node',
    description:
      'Create a new node in the knowledge graph.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the node',
        },
        type: {
          type: 'string',
          description: 'Type/category of the node (e.g. person, company, concept)',
        },
        properties: {
          type: 'object',
          description: 'Optional key-value properties for the node',
        },
      },
      required: ['name', 'type'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('create_node'),
  },
  {
    name: 'update_node',
    description:
      'Update an existing node.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'The ID of the node to update',
        },
        name: {
          type: 'string',
          description: 'New name for the node',
        },
        type: {
          type: 'string',
          description: 'New type for the node',
        },
        properties: {
          type: 'object',
          description: 'Properties to merge into the node',
        },
      },
      required: ['nodeId'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('update_node'),
  },
  {
    name: 'create_edge',
    description:
      'Create a relationship between two nodes.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'ID of the source node',
        },
        targetId: {
          type: 'string',
          description: 'ID of the target node',
        },
        label: {
          type: 'string',
          description: 'Relationship label (e.g. works_at, located_in)',
        },
        type: {
          type: 'string',
          description: 'Optional relationship category',
        },
      },
      required: ['sourceId', 'targetId', 'label'],
    },
    category: 'chat',
    executionTarget: 'local',
    execute: makeChatExecute('create_edge'),
  },
];

/**
 * Register all chat tools into the registry.
 */
export function registerChatTools(registry: ToolRegistry): void {
  registry.registerAll(CHAT_TOOLS);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/chat-tools.ts
git commit -m "feat(tools): register 10 chat tools with execute wrappers"
```

---

### Task 5: Built-in graph tools (MCP-ready)

**Files:**
- Create: `src/tools/builtin/graph-tools.ts`

New tools prefixed with `kg_` that wrap `src/commands/graph-commands.ts`. These are designed for external callers (MCP server, plugins) and use the `graph` category so they are not included in extraction or chat agent loops by default.

- [ ] **Step 1: Create graph-tools.ts**

```typescript
// src/tools/builtin/graph-tools.ts
import type { ToolRegistry } from '../registry';
import type { UnifiedToolDefinition } from '../types';
import type { CommandContext } from '../../commands/types';
import * as graphCommands from '../../commands/graph-commands';

const GRAPH_TOOLS: UnifiedToolDefinition[] = [
  {
    name: 'kg_create_node',
    description:
      'Create a new node in the knowledge graph. Returns the created node with its generated ID.',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the node',
        },
        type: {
          type: 'string',
          description: 'Structural type: "entity", "resource", or "note"',
        },
        label: {
          type: 'string',
          description: 'Semantic label for entities (e.g. concept, person, organization, technology)',
        },
        properties: {
          type: 'object',
          description: 'Key-value properties for the node',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Domain tags (e.g. technology, ai)',
        },
        sourceUrl: {
          type: 'string',
          description: 'Source URL if this node was extracted from a web page',
        },
      },
      required: ['name'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const result = await graphCommands.createNode(ctx, {
        name: input.name as string,
        type: (input.type as string) ?? 'entity',
        label: input.label as string | undefined,
        properties: (input.properties as Record<string, unknown>) ?? {},
        tags: input.tags as string[] | undefined,
        sourceUrl: input.sourceUrl as string | undefined,
      });
      if (!result.data) return JSON.stringify({ error: 'Failed to create node' });
      return JSON.stringify({ id: result.data.id, name: result.data.name, type: result.data.type });
    },
  },
  {
    name: 'kg_update_node',
    description:
      'Update an existing node by ID. Only provided fields are changed.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the node to update',
        },
        name: {
          type: 'string',
          description: 'New name for the node',
        },
        type: {
          type: 'string',
          description: 'New structural type',
        },
        label: {
          type: 'string',
          description: 'New semantic label',
        },
        properties: {
          type: 'object',
          description: 'Properties to merge into the node',
        },
      },
      required: ['nodeId'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const result = await graphCommands.updateNode(ctx, {
        id: input.nodeId as string,
        name: input.name as string | undefined,
        type: input.type as string | undefined,
        label: input.label as string | undefined,
        properties: input.properties as Record<string, unknown> | undefined,
      });
      if (!result.data) return JSON.stringify({ error: 'Node not found or update failed' });
      return JSON.stringify({ id: result.data.id, name: result.data.name });
    },
  },
  {
    name: 'kg_delete_node',
    description:
      'Delete a node by ID. Connected edges are also removed. Cleanup includes note files and source content.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the node to delete',
        },
      },
      required: ['nodeId'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const result = await graphCommands.deleteNode(ctx, input.nodeId as string);
      return JSON.stringify({ deleted: result.data });
    },
  },
  {
    name: 'kg_create_edge',
    description:
      'Create a directed relationship between two nodes.',
    parameters: {
      type: 'object',
      properties: {
        sourceId: {
          type: 'string',
          description: 'ID of the source node',
        },
        targetId: {
          type: 'string',
          description: 'ID of the target node',
        },
        label: {
          type: 'string',
          description: 'Relationship label (e.g. works_at, part_of)',
        },
        type: {
          type: 'string',
          description: 'Relationship category',
        },
      },
      required: ['sourceId', 'targetId', 'label'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const result = await graphCommands.createEdge(ctx, {
        sourceId: input.sourceId as string,
        targetId: input.targetId as string,
        label: input.label as string,
        type: (input.type as string) ?? 'related',
      });
      if (!result.data) return JSON.stringify({ error: 'Failed to create edge' });
      return JSON.stringify({ id: result.data.id, label: result.data.label });
    },
  },
  {
    name: 'kg_search_nodes',
    description:
      'Search the knowledge graph for nodes matching a text query. Uses full-text search if available, falls back to LIKE matching.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query string',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results (default 10)',
        },
      },
      required: ['query'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const results = await ctx.db.nodes.search(input.query as string, (input.limit as number) ?? 10);
      return JSON.stringify(
        (results as any[]).map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          label: n.label,
          properties: typeof n.properties === 'string' ? JSON.parse(n.properties) : n.properties,
        })),
      );
    },
  },
  {
    name: 'kg_get_node',
    description:
      'Get full details of a node by its ID.',
    parameters: {
      type: 'object',
      properties: {
        nodeId: {
          type: 'string',
          description: 'ID of the node to retrieve',
        },
      },
      required: ['nodeId'],
    },
    category: 'graph',
    executionTarget: 'local',
    execute: async (input: Record<string, unknown>, ctx: CommandContext): Promise<string> => {
      const node = await ctx.db.nodes.getById(input.nodeId as string);
      if (!node) return JSON.stringify({ error: 'Node not found' });
      return JSON.stringify({
        id: (node as any).id,
        name: (node as any).name,
        type: (node as any).type,
        label: (node as any).label,
        properties:
          typeof (node as any).properties === 'string'
            ? JSON.parse((node as any).properties)
            : (node as any).properties,
        sourceUrl: (node as any).source_url,
      });
    },
  },
];

/**
 * Register all graph tools into the registry.
 */
export function registerGraphTools(registry: ToolRegistry): void {
  registry.registerAll(GRAPH_TOOLS);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/graph-tools.ts
git commit -m "feat(tools): add 6 MCP-ready graph tools wrapping graph-commands"
```

---

### Task 6: Built-in tool registration entry point

**Files:**
- Create: `src/tools/builtin/index.ts`

- [ ] **Step 1: Create the registration entry point**

```typescript
// src/tools/builtin/index.ts
import type { ToolRegistry } from '../registry';
import { registerExtractionTools } from './extraction-tools';
import { registerChatTools } from './chat-tools';
import { registerGraphTools } from './graph-tools';

/**
 * Register all built-in tools into the given registry.
 * Called once at app startup (UI entry, offscreen document, Electron main).
 */
export function registerBuiltinTools(registry: ToolRegistry): void {
  registerExtractionTools(registry);
  registerChatTools(registry);
  registerGraphTools(registry);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/builtin/index.ts
git commit -m "feat(tools): add registerBuiltinTools entry point"
```

---

### Task 7: Tool dispatcher

**Files:**
- Create: `src/tools/dispatcher.ts`

The `ToolDispatcher` implements the existing `ToolExecutor` interface from `src/core/agent-loop.ts`. It looks up tools in the registry and dispatches execution. For `content-script` tools, it delegates to an optional fallback function provided by the platform.

- [ ] **Step 1: Create dispatcher.ts**

```typescript
// src/tools/dispatcher.ts
import type { ToolExecutor } from '../core/agent-loop';
import type { ToolCall } from '../shared/types';
import type { CommandContext } from '../commands/types';
import type { ToolRegistry } from './registry';

/**
 * Fallback executor for content-script tools.
 * Chrome offscreen provides one (sends message to SW -> content script).
 * Electron returns an error (content script tools not available).
 */
export type ContentScriptFallback = (
  tc: ToolCall,
) => Promise<{ result: string; error?: string }>;

export interface ToolDispatcherConfig {
  registry: ToolRegistry;
  ctx: CommandContext;
  /**
   * Optional fallback for tools with executionTarget='content-script'.
   * If not provided, content-script tools return an error.
   */
  contentScriptFallback?: ContentScriptFallback;
  /**
   * Optional tool allowlist. When set, only tools whose names are in this set
   * will be exposed to the LLM and executed. Used by preset allowedTools.
   * If undefined, all registered tools are available.
   */
  allowedToolNames?: Set<string>;
}

/**
 * ToolDispatcher adapts the ToolRegistry into the ToolExecutor interface
 * consumed by the shared agent loop (src/core/agent-loop.ts).
 *
 * Dispatch strategy:
 * 1. Look up tool in registry by name
 * 2. If tool has executionTarget='content-script', use contentScriptFallback
 * 3. If tool has an execute function, call it with (input, ctx)
 * 4. Otherwise return an error
 */
export class ToolDispatcher implements ToolExecutor {
  private registry: ToolRegistry;
  private ctx: CommandContext;
  private contentScriptFallback?: ContentScriptFallback;
  private allowedToolNames?: Set<string>;

  constructor(config: ToolDispatcherConfig) {
    this.registry = config.registry;
    this.ctx = config.ctx;
    this.contentScriptFallback = config.contentScriptFallback;
    this.allowedToolNames = config.allowedToolNames;
  }

  /** Get tool definitions filtered by the allowlist (if set). */
  getTools(filter?: ToolFilter): UnifiedToolDefinition[] {
    const baseFilter = { ...filter };
    if (this.allowedToolNames) {
      baseFilter.allowedNames = [...this.allowedToolNames];
    }
    return this.registry.list(baseFilter);
  }

  async execute(tc: ToolCall): Promise<{ result: string; error?: string }> {
    // Enforce allowlist at execution time too (not just prompt exposure)
    if (this.allowedToolNames && !this.allowedToolNames.has(tc.name)) {
      return { result: '', error: `Tool "${tc.name}" is not available in this session` };
    }

    const tool = this.registry.get(tc.name);
    if (!tool) {
      return { result: '', error: `Unknown tool: ${tc.name}` };
    }

    // Content-script tools are dispatched via platform messaging
    if (tool.executionTarget === 'content-script') {
      if (this.contentScriptFallback) {
        return this.contentScriptFallback(tc);
      }
      return {
        result: '',
        error: `Content script tools are not available in this context. Use fetch_url to read web pages instead.`,
      };
    }

    // Local tools with an execute function
    if (tool.execute) {
      try {
        const result = await tool.execute(tc.input, this.ctx);
        return { result };
      } catch (e: any) {
        return { result: '', error: e.message };
      }
    }

    return {
      result: '',
      error: `Tool ${tc.name} has no execute function and cannot be dispatched locally.`,
    };
  }
}

/**
 * Create a ToolDispatcher from a registry and context.
 * Convenience factory for common use cases.
 */
export function createToolDispatcher(
  registry: ToolRegistry,
  ctx: CommandContext,
  contentScriptFallback?: ContentScriptFallback,
): ToolDispatcher {
  return new ToolDispatcher({ registry, ctx, contentScriptFallback });
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/dispatcher.ts
git commit -m "feat(tools): add ToolDispatcher implementing ToolExecutor interface"
```

---

### Task 8: Dynamic system prompt builder

**Files:**
- Create: `src/tools/prompt-builder.ts`

Generates system prompts from registered tool metadata. Replaces the hardcoded `getAgentSystemPrompt()` from `src/core/system-prompts.ts` while preserving the exact same extraction workflow instructions. Also generates chat system prompts.

- [ ] **Step 1: Create prompt-builder.ts**

```typescript
// src/tools/prompt-builder.ts
import type { ToolRegistry } from './registry';
import type { ToolCategory, UnifiedToolDefinition } from './types';

export interface PromptBuilderOptions {
  /** Include notes extraction rules in the prompt */
  notesEnabled?: boolean;
  /** Additional instructions to append */
  additionalInstructions?: string;
}

/**
 * Build a tool-listing block from registered tools for embedding in a
 * system prompt. Lists tool names and descriptions in a compact format.
 */
function buildToolListing(tools: UnifiedToolDefinition[]): string {
  if (tools.length === 0) return '';
  const lines = tools.map(
    (t) => `- **${t.name}**: ${t.description}`,
  );
  return `## Available Tools\n\n${lines.join('\n')}`;
}

/**
 * Build the extraction agent system prompt from registered tools.
 * Preserves the exact workflow and rules from the original handcrafted
 * prompt in src/core/system-prompts.ts, but generates the tool listing
 * dynamically from the registry.
 */
export function buildExtractionSystemPrompt(
  registry: ToolRegistry,
  options?: PromptBuilderOptions,
): string {
  const tools = registry.list({ category: 'extraction' });

  const contentScriptTools = tools
    .filter((t) => t.executionTarget === 'content-script')
    .map((t) => t.name);

  const notesRules = options?.notesEnabled
    ? `

Rules for NOTES (enabled):
- When calling save_entities, include exactly ONE note in the "notes" array — a structured summary of the resource.
- Title: "Summary: <page title>"
- The note content MUST be markdown with this structure:
  1. **TL;DR** section first — 2-3 sentences capturing the core message.
  2. Then 3-5 **sections** that break down the content by topic/theme. Each section should have a ## heading and a descriptive paragraph.
  3. Include **markdown tables** where the page contains structured/comparative data (features, specs, comparisons, timelines, etc.). Reproduce key tables from the source.
  4. Include **images** from the page where relevant using ![description](image_url). Use the original image URLs from the page. Only include images that add value (diagrams, charts, screenshots), not decorative ones.
- Use [[Entity Name]] wikilinks to reference entities from the nodes array.
- "about" lists 1-3 key entities the note covers. "mentions" lists other referenced entities.
- Entity names in about/mentions must match the nodes array exactly.`
    : '';

  let prompt = `You are a knowledge graph extraction agent. Your job is to inspect a web page using the provided tools, then extract entities (nodes) and typed relationships (edges) into a structured knowledge graph.

Workflow:
1. Start by using get_page_metadata to understand the page structure
2. Use get_page_content to read the main content (returns markdown by default, preserving headings, links, tables, and lists). Use format: "text" only if you need plain text.
3. Use more targeted tools (${contentScriptTools.filter((n) => !['get_page_content', 'get_page_metadata'].includes(n)).join(', ')}) for specific content if needed
4. If the user asks about linked content, use fetch_url to read linked pages (also returns markdown)
5. When you have gathered enough information, call save_entities with the extracted nodes and edges

Rules for NODES:
- Do NOT output resource nodes. The system automatically creates a resource node for the source URL. Every node you emit is an entity.
- Use the "label" field on each node to categorize it semantically. Allowed labels:
  concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Include relevant properties as key-value pairs on nodes.
- Include a "tags" array for domain annotations (e.g. ["technology", "ai"]).

Rules for EDGES:
- Leverage markdown structure (headings, tables, links) to identify relationships more accurately.
- Prefer these seed relationship labels when applicable: subfield_of, part_of, instance_of, created_by, affiliated_with, used_in, builds_on, enables, contradicts, alternative_to, preceded_by.
- Otherwise use consistent, lowercase snake_case labels (e.g., "works_at", "located_in").
- Ensure all edges reference entities that exist in your nodes array by their exact name.
- Call save_entities exactly once when done — it is the terminal tool.${notesRules}

Be efficient: don't call tools unnecessarily. If get_page_content gives you everything you need, proceed directly to save_entities.`;

  if (options?.additionalInstructions) {
    prompt += `\n\n${options.additionalInstructions}`;
  }

  return prompt;
}

/**
 * Build the chat agent system prompt. This is the static prompt —
 * the tool listing is handled by the Anthropic API tools parameter,
 * not embedded in the prompt.
 */
export function buildChatSystemPrompt(
  _registry: ToolRegistry,
  options?: PromptBuilderOptions,
): string {
  let prompt = `You are a helpful assistant integrated into a personal knowledge graph browser extension. You have access to tools that let you search, read, and modify the user's knowledge graph.

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

  if (options?.additionalInstructions) {
    prompt += `\n\n${options.additionalInstructions}`;
  }

  return prompt;
}

/**
 * Generic prompt builder — dispatches to the right builder based on category.
 */
export function buildToolSystemPrompt(
  registry: ToolRegistry,
  category: ToolCategory,
  options?: PromptBuilderOptions,
): string {
  switch (category) {
    case 'extraction':
      return buildExtractionSystemPrompt(registry, options);
    case 'chat':
      return buildChatSystemPrompt(registry, options);
    default:
      // For graph/custom categories, generate a generic tool listing
      const tools = registry.list({ category });
      return buildToolListing(tools);
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/prompt-builder.ts
git commit -m "feat(tools): add dynamic system prompt builder from registry"
```

---

### Task 9: Barrel export

**Files:**
- Create: `src/tools/index.ts`

- [ ] **Step 1: Create barrel file**

```typescript
// src/tools/index.ts
export type {
  UnifiedToolDefinition,
  ToolCategory,
  ToolExecutionTarget,
  ToolFilter,
  AnthropicTool,
} from './types';
export { ToolRegistry, toolRegistry } from './registry';
export {
  ToolDispatcher,
  createToolDispatcher,
  type ContentScriptFallback,
  type ToolDispatcherConfig,
} from './dispatcher';
export {
  buildToolSystemPrompt,
  buildExtractionSystemPrompt,
  buildChatSystemPrompt,
} from './prompt-builder';
export { registerBuiltinTools } from './builtin';
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/tools/index.ts
git commit -m "feat(tools): add barrel export for tools module"
```

---

### Task 10: Parameterize the shared agent loop

**Files:**
- Modify: `src/core/agent-loop.ts`

The shared agent loop currently imports `AGENT_TOOLS`, `toAnthropicTools`, and `getAgentSystemPrompt` directly. Change it to accept tools and system prompt as parameters so callers can inject registry-sourced values.

- [ ] **Step 1: Update AgentLoopConfig to accept tools and system prompt**

In `src/core/agent-loop.ts`, add fields to `AgentLoopConfig`:

```typescript
export interface AgentLoopConfig {
  runId: string;
  userPrompt: string;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
  /** Optional: pre-built Anthropic tools array. If not provided, falls back to AGENT_TOOLS. */
  tools?: Array<{ name: string; description: string; input_schema: Record<string, unknown> }>;
  /** Optional: custom system prompt. If not provided, falls back to getAgentSystemPrompt(). */
  systemPrompt?: string;
  /** Optional: tool names that are terminal (agent loop stops after them). Defaults to ['save_entities']. */
  terminalTools?: string[];
}
```

- [ ] **Step 2: Update runAgentLoop to use config.tools and config.systemPrompt**

Replace lines 46-47 of `src/core/agent-loop.ts`:

```typescript
  const systemPrompt = getAgentSystemPrompt(config.notesEnabled ?? false);
  const anthropicTools = toAnthropicTools(AGENT_TOOLS);
```

with:

```typescript
  const systemPrompt = config.systemPrompt ?? getAgentSystemPrompt(config.notesEnabled ?? false);
  const anthropicTools = config.tools ?? toAnthropicTools(AGENT_TOOLS);
  const terminalToolNames = new Set(config.terminalTools ?? ['save_entities']);
```

- [ ] **Step 3: Replace hardcoded 'save_entities' check with terminalTools**

Replace line 95:

```typescript
      if (tc.name === 'save_entities') {
```

with:

```typescript
      if (terminalToolNames.has(tc.name)) {
```

The body of this block stays the same for now. The `tc.input as unknown as ExtractionResult` cast is extraction-specific.

**⚠️ Known limitation:** Terminal tool handling currently assumes `ExtractionResult` shape. When non-extraction terminal tools are added later, add an `onTerminal?: (input: unknown) => void` callback to `UnifiedToolDefinition` and dispatch through it instead of the hardcoded cast. For now, `save_entities` is the only terminal tool, so the cast is safe.

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron-main 2>&1 | tail -5
```

The build must still pass because `AGENT_TOOLS`, `toAnthropicTools`, and `getAgentSystemPrompt` remain as fallback imports. Existing callers pass no `tools`/`systemPrompt`, so behavior is unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/core/agent-loop.ts
git commit -m "refactor(agent-loop): accept tools and systemPrompt as optional config parameters"
```

---

### Task 11: Wire Chrome offscreen agent loop to use registry

**Files:**
- Modify: `src/offscreen/agent-loop.ts`

Update the Chrome offscreen agent loop to use the registry for tool definitions and the dispatcher for `fetch_url` execution, while keeping content-script tools dispatched via `chrome.runtime.sendMessage`.

- [ ] **Step 1: Add imports and initialize registry**

Add to the top of `src/offscreen/agent-loop.ts`:

```typescript
import { toolRegistry } from '../tools/registry';
import { registerBuiltinTools } from '../tools/builtin';
import { createToolDispatcher, type ContentScriptFallback } from '../tools/dispatcher';
import { buildExtractionSystemPrompt } from '../tools/prompt-builder';
```

Add a one-time initialization guard after the imports:

```typescript
let registryInitialized = false;
function ensureRegistry(): void {
  if (registryInitialized) return;
  registerBuiltinTools(toolRegistry);
  registryInitialized = true;
}
```

- [ ] **Step 2: Update ContentScriptToolExecutor to be a ContentScriptFallback**

Replace the `ContentScriptToolExecutor` class (lines 21-56) with a factory function that returns a `ContentScriptFallback`:

```typescript
function createContentScriptFallback(tabId: number, runId: string): ContentScriptFallback {
  return (tc) => {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ result: '', error: `Tool ${tc.name} timed out after ${TOOL_TIMEOUT_MS / 1000}s` });
      }, TOOL_TIMEOUT_MS);

      chrome.runtime.sendMessage(
        { type: 'TOOL_EXECUTE', payload: { runId, toolCallId: tc.id, toolName: tc.name, toolInput: tc.input, tabId } },
        (response) => {
          clearTimeout(timeout);
          if (chrome.runtime.lastError) resolve({ result: '', error: chrome.runtime.lastError.message });
          else if (response?.error) resolve({ result: response.result ?? '', error: response.error });
          else resolve({ result: response?.result ?? '' });
        },
      );
    });
  };
}
```

- [ ] **Step 3: Update runAgentLoop to use registry + dispatcher**

Replace the `runAgentLoop` function body (lines 58-73):

```typescript
export async function runAgentLoop(params: AgentLoopParams): Promise<void> {
  ensureRegistry();

  // Build a minimal CommandContext for the offscreen context.
  // Offscreen only needs fetch_url execution — no DB or notes access.
  const minimalCtx = {
    db: {} as any,
    storage: {} as any,
    notes: {} as any,
    llm: {} as any,
    browser: {} as any,
    getGraphSnapshot: async () => ({ nodes: [], edges: [] }),
  };

  // Override fetch_url with the offscreen-specific implementation that
  // includes URL blocking and HTML-to-markdown conversion
  const fetchUrlTool = toolRegistry.get('fetch_url');
  if (fetchUrlTool) {
    fetchUrlTool.execute = async (input: Record<string, unknown>) => {
      const url = input.url as string;
      if (isBlockedUrl(url)) return JSON.stringify({ error: 'URL is blocked or invalid' });
      const { content, error } = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
      if (error) return JSON.stringify({ error });
      return content;
    };
  }

  const contentScriptFallback = createContentScriptFallback(params.tabId, params.runId);
  const dispatcher = createToolDispatcher(toolRegistry, minimalCtx, contentScriptFallback);

  const extractionTools = toolRegistry.toAnthropicTools({ category: 'extraction' });
  const systemPrompt = buildExtractionSystemPrompt(toolRegistry, {
    notesEnabled: params.notesEnabled,
  });

  // Find terminal tool names from registry
  const terminalTools = toolRegistry
    .list({ category: 'extraction' })
    .filter((t) => t.terminal)
    .map((t) => t.name);

  await coreRunAgentLoop(
    {
      runId: params.runId,
      userPrompt: params.userPrompt,
      apiKey: params.apiKey,
      model: params.model,
      maxIterations: params.maxIterations,
      notesEnabled: params.notesEnabled,
      tools: extractionTools,
      systemPrompt,
      terminalTools,
    },
    streamAnthropicWithTools,
    dispatcher,
    params.onProgress,
  );
}
```

- [ ] **Step 4: Remove unused imports**

Remove these imports that are no longer needed:

```typescript
// Remove:
import { AGENT_TOOLS } from '../shared/agent-tools';
```

Keep `fetchAndCleanContent` and `isBlockedUrl` imports from `./url-utils` (still used by the fetch_url override).

- [ ] **Step 5: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/offscreen/agent-loop.ts
git commit -m "refactor(chrome): wire offscreen agent loop to tool registry + dispatcher"
```

---

### Task 12: Wire Electron llm-backend to use registry

**Files:**
- Modify: `electron/llm-backend.ts`

Update the Electron main process agent handlers to use the registry and dispatcher. The Electron context has no content scripts, so the dispatcher's content-script fallback returns an error.

- [ ] **Step 1: Add imports and initialization**

Add to the top of `electron/llm-backend.ts`:

```typescript
import { toolRegistry } from '../src/tools/registry';
import { registerBuiltinTools } from '../src/tools/builtin';
import { createToolDispatcher } from '../src/tools/dispatcher';
import { buildExtractionSystemPrompt } from '../src/tools/prompt-builder';
```

Add initialization guard:

```typescript
let registryInitialized = false;
function ensureRegistry(): void {
  if (registryInitialized) return;
  registerBuiltinTools(toolRegistry);
  registryInitialized = true;
}
```

- [ ] **Step 2: Create a helper to build the Electron extraction dispatcher**

Add after the initialization guard:

```typescript
function createElectronExtractionDispatcher(): ToolExecutor {
  // Minimal context — Electron agent only needs fetch_url
  const minimalCtx = {
    db: {} as any,
    storage: {} as any,
    notes: {} as any,
    llm: {} as any,
    browser: {} as any,
    getGraphSnapshot: async () => ({ nodes: [], edges: [] }),
  };

  const dispatcher = createToolDispatcher(toolRegistry, minimalCtx);

  // Override fetch_url with the Electron-specific implementation
  const originalExecute = dispatcher.execute.bind(dispatcher);
  return {
    async execute(tc) {
      if (tc.name === 'fetch_url') {
        const url = tc.input.url as string;
        if (isBlockedUrl(url)) return { result: '', error: 'URL is blocked or invalid' };
        const res = await fetchAndCleanContent(url, FETCH_MAX_BYTES);
        return { result: res.content, error: res.error };
      }
      return originalExecute(tc);
    },
  };
}
```

- [ ] **Step 3: Update handleAgentRun to use dispatcher**

Replace the `toolExecutor` definition in `handleAgentRun` (lines 184-199) with:

```typescript
    ensureRegistry();
    const toolExecutor = createElectronExtractionDispatcher();

    const extractionTools = toolRegistry.toAnthropicTools({ category: 'extraction' });
    const systemPrompt = buildExtractionSystemPrompt(toolRegistry, {
      notesEnabled: notesEnabled ?? false,
    });
    const terminalTools = toolRegistry
      .list({ category: 'extraction' })
      .filter((t) => t.terminal)
      .map((t) => t.name);
```

Update the `coreRunAgentLoop` call to pass the new config fields:

```typescript
    await coreRunAgentLoop(
      {
        runId, userPrompt, apiKey, model,
        notesEnabled: notesEnabled ?? false,
        tools: extractionTools,
        systemPrompt,
        terminalTools,
      },
      streamAnthropicWithTools,
      toolExecutor,
      (event: AgentProgressEvent) => {
        broadcast({ type: 'AGENT_PROGRESS', payload: { runId, event } });
        if (event.type === 'done' && event.inputTokens != null) {
          coreRecordUsage(usageStore, 'agent', model, event.inputTokens, event.outputTokens ?? 0);
        }
      },
    );
```

- [ ] **Step 4: Update handleRunAgent (dedicated IPC handler) the same way**

Replace the `toolExecutor` definition in `handleRunAgent` (lines 265-279) with the same pattern:

```typescript
    ensureRegistry();
    const toolExecutor = createElectronExtractionDispatcher();

    const extractionTools = toolRegistry.toAnthropicTools({ category: 'extraction' });
    const systemPrompt = buildExtractionSystemPrompt(toolRegistry, {
      notesEnabled: notesEnabled ?? false,
    });
    const terminalTools = toolRegistry
      .list({ category: 'extraction' })
      .filter((t) => t.terminal)
      .map((t) => t.name);
```

Update its `coreRunAgentLoop` call:

```typescript
    await coreRunAgentLoop(
      {
        runId, userPrompt, apiKey, model,
        notesEnabled: notesEnabled ?? false,
        tools: extractionTools,
        systemPrompt,
        terminalTools,
      },
      streamAnthropicWithTools,
      toolExecutor,
      (event: AgentProgressEvent) => {
        send('llm:agent-progress', { runId, event });
        if (event.type === 'done' && event.inputTokens != null) {
          coreRecordUsage(getUsageStore(), 'agent', model, event.inputTokens, event.outputTokens ?? 0);
        }
      },
    );
```

- [ ] **Step 5: Remove unused AGENT_TOOLS import**

Remove:

```typescript
// Remove:
import { AGENT_TOOLS } from '../src/shared/agent-tools';
```

Keep `ToolExecutor` import from `src/core/agent-loop` (still used as type annotation).

- [ ] **Step 6: Verify both builds**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 7: Commit**

```bash
git add electron/llm-backend.ts
git commit -m "refactor(electron): wire agent handlers to tool registry + dispatcher"
```

---

### Task 13: Wire chat-agent-loop to use registry

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`

Update the chat agent loop to get tool definitions from the registry instead of importing `CHAT_AGENT_TOOLS` directly.

- [ ] **Step 1: Add registry imports and initialization**

Add to the top of `src/ui/hooks/chat-agent-loop.ts`:

```typescript
import { toolRegistry } from '../../tools/registry';
import { registerBuiltinTools } from '../../tools/builtin';
import { buildChatSystemPrompt } from '../../tools/prompt-builder';
```

Add initialization guard:

```typescript
let registryInitialized = false;
function ensureRegistry(): void {
  if (registryInitialized) return;
  registerBuiltinTools(toolRegistry);
  registryInitialized = true;
}
```

- [ ] **Step 2: Replace TOOL_DEFS and CHAT_AGENT_SYSTEM_PROMPT**

Replace line 27-28:

```typescript
const MAX_ITERATIONS = 10;
const TOOL_DEFS = toAnthropicChatTools(CHAT_AGENT_TOOLS);
```

with:

```typescript
const MAX_ITERATIONS = 10;

function getChatToolDefs() {
  ensureRegistry();
  return toolRegistry.toAnthropicTools({ category: 'chat' });
}

function getChatSystemPrompt() {
  ensureRegistry();
  return buildChatSystemPrompt(toolRegistry);
}
```

- [ ] **Step 3: Update runChatAgent to use dynamic defs**

In the `runChatAgent` function, replace the `sendChatLLMRequest` call (around line 103-113). Change:

```typescript
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt: CHAT_AGENT_SYSTEM_PROMPT,
        messages,
        tools: TOOL_DEFS,
      },
      onProgress,
    );
```

to:

```typescript
    const result = await sendChatLLMRequest(
      requestId,
      {
        provider,
        model,
        systemPrompt: getChatSystemPrompt(),
        messages,
        tools: getChatToolDefs(),
      },
      onProgress,
    );
```

- [ ] **Step 4: Remove unused imports**

Remove:

```typescript
// Remove:
import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
```

Keep the `CHAT_AGENT_SYSTEM_PROMPT` export if other files import it. Check with:

```bash
grep -r "CHAT_AGENT_SYSTEM_PROMPT" src/ --include='*.ts' --include='*.tsx' -l
```

If only `chat-agent-loop.ts` uses it, remove it entirely. If other files import it, keep a re-export:

```typescript
export { buildChatSystemPrompt as CHAT_AGENT_SYSTEM_PROMPT_BUILDER } from '../../tools/prompt-builder';
// For backward compat:
export const CHAT_AGENT_SYSTEM_PROMPT = getChatSystemPrompt();
```

- [ ] **Step 5: Verify both builds**

```bash
npm run build 2>&1 | tail -5 && npm run build:electron 2>&1 | tail -5
```

- [ ] **Step 6: Commit**

```bash
git add src/ui/hooks/chat-agent-loop.ts
git commit -m "refactor(chat): wire chat agent loop to tool registry"
```

---

### Task 14: Final verification

- [ ] **Step 1: Full build (all targets)**

```bash
npm run build 2>&1 | tail -5
npm run build:electron 2>&1 | tail -5
```

Both must succeed with zero errors.

- [ ] **Step 2: Verify registry snapshot**

Add a temporary `console.log` in the offscreen document or Electron main to confirm tool registration:

```typescript
ensureRegistry();
console.log('Tool registry:', toolRegistry.snapshot());
console.log('Extraction tools:', toolRegistry.list({ category: 'extraction' }).length);
console.log('Chat tools:', toolRegistry.list({ category: 'chat' }).length);
console.log('Graph tools:', toolRegistry.list({ category: 'graph' }).length);
```

Expected output:
- Extraction tools: 9
- Chat tools: 10
- Graph tools: 6
- Total: 25

Remove the console.log after verification.

- [ ] **Step 3: Manual smoke test (Chrome)**

1. Load `dist/` as unpacked extension
2. Open side panel on any page
3. Run agent extraction on a page (triggers extraction tools via registry)
4. Verify: tool calls appear, extraction completes, review shows entities
5. Open chat and ask about something in the graph (triggers chat tools via registry)
6. Verify: `search_knowledge` etc. tool calls work, response includes citations

- [ ] **Step 4: Manual smoke test (Electron)**

1. Run `npx electron .` after building
2. Run agent extraction using a URL (only fetch_url available, content-script tools return helpful error)
3. Chat with the agent
4. Verify same behavior as Chrome minus content-script tools

---

## Summary

After all 14 tasks:

**New files (9):**
- `src/tools/types.ts` — `UnifiedToolDefinition`, `ToolFilter`, `ToolCategory`
- `src/tools/registry.ts` — `ToolRegistry` class + `toolRegistry` singleton
- `src/tools/builtin/extraction-tools.ts` — 9 extraction tools registered
- `src/tools/builtin/chat-tools.ts` — 10 chat tools with execute wrappers
- `src/tools/builtin/graph-tools.ts` — 6 MCP-ready graph tools
- `src/tools/builtin/index.ts` — `registerBuiltinTools()` entry point
- `src/tools/dispatcher.ts` — `ToolDispatcher` implementing `ToolExecutor`
- `src/tools/prompt-builder.ts` — Dynamic system prompt generation
- `src/tools/index.ts` — Barrel export

**Modified files (4):**
- `src/core/agent-loop.ts` — Accept optional `tools`, `systemPrompt`, `terminalTools` in config
- `src/offscreen/agent-loop.ts` — Use registry + dispatcher instead of hardcoded arrays
- `electron/llm-backend.ts` — Use registry + dispatcher instead of inline switches
- `src/ui/hooks/chat-agent-loop.ts` — Use registry for tool defs and prompt

**Not deleted (backward compat):**
- `src/shared/agent-tools.ts` — Kept as fallback import in `src/core/agent-loop.ts`. Can be deleted in Phase 3 after all callers are migrated.
- `src/shared/chat-agent-tools.ts` — Same, kept for any remaining importers.
- `src/core/system-prompts.ts` — Kept as fallback for `agent-loop.ts`. The new prompt builder produces identical output.

**Registry tool count: 25** (9 extraction + 10 chat + 6 graph)

---

## Target file

This plan should be saved to:
`/Users/brian/Desktop/code/sideproject/kg_extension/docs/superpowers/plans/2026-05-03-phase2-tool-registry.md`
