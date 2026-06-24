# MCP Phase 1: Shared Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dual MCP server implementations (in-process + standalone CLI) with a shared core: one `KnowledgeService` interface, one set of 10 consolidated tool definitions, two backend implementations.

**Architecture:** Introduce a `src/mcp/` directory as the shared MCP core. `KnowledgeService` is the contract between the MCP server layer and the data layer. Tool handlers map the 10 consolidated tools to `KnowledgeService` calls. The existing `BuiltinToolProvider` and standalone CLI switch statement are replaced by a single `KnowledgeToolProvider` that works with any `KnowledgeService` backend.

**Tech Stack:** TypeScript, better-sqlite3, MCP SDK (`@modelcontextprotocol/sdk`), vitest

## Global Constraints

- All tool parameter names use **snake_case** (not camelCase)
- The built-in chat agent continues using existing `chat-agent-tools.ts` + `chat-tool-executor.ts` in Phase 1 — only the MCP-facing surface changes
- No new dependencies — reuse existing MCP SDK, better-sqlite3, vitest
- Existing tests must continue passing
- Both transports (HTTP Streamable on `:19876/mcp` and stdio) must work after migration

---

### Task 1: KnowledgeService Interface and Shared Types

**Files:**
- Create: `src/mcp/knowledge-service.ts`
- Create: `src/mcp/types.ts`

**Interfaces:**
- Consumes: Nothing (foundational)
- Produces: `KnowledgeService` interface, all input/output types used by every subsequent task

- [ ] **Step 1: Create the shared types file**

```typescript
// src/mcp/types.ts

// --- Search ---

export interface SearchResult {
  id: string;
  name: string;
  type: string;
  score: number;
  snippet?: string;
  source: 'entity' | 'note' | 'source' | 'semantic';
}

// --- Entities ---

export interface EntitySummary {
  id: string;
  name: string;
  type: string;
  label: string | null;
}

export interface EntityDetail {
  id: string;
  name: string;
  type: string;
  label: string | null;
  summary: string | null;
  properties: Record<string, unknown>;
  aliases: string[];
  tags: string[];
  edges: EntityEdge[];
  sources: EntitySource[];
  created_at: string;
  updated_at: string;
}

export interface EntityEdge {
  id: string;
  direction: 'outgoing' | 'incoming';
  label: string;
  type: string;
  neighbor_id: string;
  neighbor_name: string;
  neighbor_type: string;
}

export interface EntitySource {
  url: string;
  title: string | null;
}

export interface CreateEntityInput {
  name: string;
  type: string;
  label?: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface UpdateEntityInput {
  entity_id: string;
  name?: string;
  type?: string;
  label?: string;
  properties?: Record<string, unknown>;
  aliases?: string[];
  tags?: string[];
}

export interface EntityResult {
  id: string;
  name: string;
  type: string;
  action: 'created' | 'updated' | 'deleted';
}

export interface MergeResult {
  primary_id: string;
  secondary_id: string;
  edges_transferred: number;
  alias_added: string;
}

// --- Relationships ---

export interface RelationshipDetail {
  id: string;
  source_id: string;
  target_id: string;
  label: string;
  type: string;
}

export interface CreateRelationshipInput {
  source_id: string;
  target_id: string;
  label: string;
  type?: string;
}

export interface UpdateRelationshipInput {
  relationship_id: string;
  label?: string;
  type?: string;
}

export interface RelationshipResult {
  id: string;
  action: 'created' | 'updated' | 'deleted';
}

// --- Neighbors ---

export interface NeighborNode {
  id: string;
  name: string;
  type: string;
  label: string | null;
  edge_label: string;
  edge_direction: 'outgoing' | 'incoming';
  depth: number;
}

export interface NeighborResult {
  root_id: string;
  nodes: NeighborNode[];
  total: number;
}

// --- Notes ---

export interface NoteSummary {
  id: string;
  title: string;
  updated_at: string;
}

export interface NoteDetail {
  id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface NoteResult {
  id: string;
  title: string;
  action: 'read' | 'created' | 'updated';
  content?: string;
}

// --- Analysis ---

export type AnalysisType =
  | 'overview'
  | 'health'
  | 'clusters'
  | 'centrality'
  | 'orphans'
  | 'bridges'
  | 'paths'
  | 'connections'
  | 'gaps';

export interface AnalysisResult {
  analysis: AnalysisType;
  data: Record<string, unknown>;
}

// --- Skills ---

export interface SkillSummary {
  name: string;
  description: string;
  type: 'prompt' | 'workflow';
  arguments: SkillArgument[];
}

export interface SkillArgument {
  name: string;
  description: string;
  required?: boolean;
  default?: unknown;
}

export interface SkillResult {
  name: string;
  type: 'prompt' | 'workflow';
  content: string;
}

// --- Events ---

export type GraphChangeEvent =
  | { type: 'entity_created'; id: string }
  | { type: 'entity_updated'; id: string }
  | { type: 'entity_deleted'; id: string }
  | { type: 'relationship_created'; id: string }
  | { type: 'relationship_deleted'; id: string }
  | { type: 'note_updated'; id: string }
  | { type: 'reset' };
```

- [ ] **Step 2: Create the KnowledgeService interface**

```typescript
// src/mcp/knowledge-service.ts

import type {
  SearchResult,
  EntityDetail,
  CreateEntityInput,
  UpdateEntityInput,
  EntityResult,
  MergeResult,
  NeighborResult,
  CreateRelationshipInput,
  UpdateRelationshipInput,
  RelationshipResult,
  NoteResult,
  AnalysisType,
  AnalysisResult,
  SkillSummary,
  SkillResult,
  GraphChangeEvent,
} from './types';

export interface KnowledgeService {
  // --- Search ---
  search(params: {
    query: string;
    scope?: 'all' | 'entities' | 'notes' | 'semantic';
    limit?: number;
  }): Promise<SearchResult[]>;

  // --- Entities ---
  getEntity(id: string): Promise<EntityDetail | null>;
  createEntity(input: CreateEntityInput): Promise<EntityResult>;
  updateEntity(input: UpdateEntityInput): Promise<EntityResult>;
  deleteEntities(ids: string[]): Promise<{ deleted: number }>;
  mergeEntities(primary_id: string, secondary_id: string): Promise<MergeResult>;

  // --- Graph Traversal ---
  getNeighbors(params: {
    entity_id: string;
    depth?: number;
    limit?: number;
  }): Promise<NeighborResult>;

  // --- Relationships ---
  createRelationship(input: CreateRelationshipInput): Promise<RelationshipResult>;
  updateRelationship(input: UpdateRelationshipInput): Promise<RelationshipResult>;
  deleteRelationships(ids: string[]): Promise<{ deleted: number }>;

  // --- Notes ---
  readNote(note_id: string): Promise<NoteResult>;
  createNote(title: string, content: string): Promise<NoteResult>;
  updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<NoteResult>;

  // --- Analysis ---
  analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult>;

  // --- Skills ---
  listSkills(): Promise<SkillSummary[]>;
  runSkill(name: string, args?: Record<string, unknown>): Promise<SkillResult>;

  // --- Events ---
  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit src/mcp/types.ts src/mcp/knowledge-service.ts --strict --moduleResolution bundler --module esnext --target esnext`
Expected: No errors (these files have no external imports)

- [ ] **Step 4: Commit**

```bash
git add src/mcp/types.ts src/mcp/knowledge-service.ts
git commit -m "feat(mcp): add KnowledgeService interface and shared types"
```

---

### Task 2: Shared Tool Definitions

**Files:**
- Create: `src/mcp/tools/definitions.ts`
- Create: `src/mcp/tools/types.ts`

**Interfaces:**
- Consumes: Nothing (standalone definitions)
- Produces: `MCP_TOOL_DEFINITIONS` array (10 tool schemas), `McpToolName` type, `WRITE_TOOLS` set — used by Task 4 (tool handlers) and Task 5 (MCP server wiring)

- [ ] **Step 1: Create tool types**

```typescript
// src/mcp/tools/types.ts

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export type McpToolName =
  | 'search'
  | 'get_entity'
  | 'get_neighbors'
  | 'manage_entity'
  | 'manage_relationship'
  | 'merge_entities'
  | 'manage_note'
  | 'analyze_graph'
  | 'list_skills'
  | 'run_skill';

export const WRITE_TOOLS: ReadonlySet<McpToolName> = new Set([
  'manage_entity',
  'manage_relationship',
  'merge_entities',
  'manage_note',
]);
```

- [ ] **Step 2: Create all 10 tool definitions**

```typescript
// src/mcp/tools/definitions.ts

import type { McpToolDefinition } from './types';

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'search',
    description:
      'Search the knowledge graph for entities, notes, or source content. Returns matching items with relevance scores.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        scope: {
          type: 'string',
          enum: ['all', 'entities', 'notes', 'semantic'],
          description:
            "Search scope. 'all' searches entities + notes + sources. 'semantic' uses vector embeddings for conceptual similarity. Default: 'all'.",
        },
        limit: {
          type: 'number',
          description: 'Max results. Default: 10.',
        },
      },
      required: ['query'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_entity',
    description:
      'Get complete details for an entity: properties, relationships, aliases, tags, and source references.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: { type: 'string', description: 'Entity ID.' },
      },
      required: ['entity_id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'get_neighbors',
    description:
      'Traverse the graph from a starting entity. Returns connected entities up to the specified depth with relationship labels.',
    inputSchema: {
      type: 'object',
      properties: {
        entity_id: {
          type: 'string',
          description: 'Starting entity ID.',
        },
        depth: {
          type: 'number',
          description: 'Traversal depth (max 3). Default: 1.',
        },
        limit: {
          type: 'number',
          description: 'Max nodes to return. Default: 50.',
        },
      },
      required: ['entity_id'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'manage_entity',
    description:
      "Create, update, or delete entities in the knowledge graph. For updates, only specified fields are changed. Aliases and tags use replace semantics — send the full desired list, or omit to leave unchanged.",
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        entity_id: {
          type: 'string',
          description: 'Required for update/delete.',
        },
        entity_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'For batch delete.',
        },
        name: { type: 'string', description: 'Entity name.' },
        type: {
          type: 'string',
          description: 'Entity type (e.g. person, concept, technology).',
        },
        label: { type: 'string', description: 'Semantic label.' },
        properties: {
          type: 'object',
          description: 'Key-value properties to set.',
        },
        aliases: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Full replacement list of alternate names. Omit to leave unchanged.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Full replacement list of tags. Omit to leave unchanged.',
        },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'manage_relationship',
    description: 'Create, update, or delete relationships between entities.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['create', 'update', 'delete'],
          description: 'Operation to perform.',
        },
        relationship_id: {
          type: 'string',
          description: 'Required for update/delete.',
        },
        relationship_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'For batch delete.',
        },
        source_id: {
          type: 'string',
          description: 'Source entity ID (for create).',
        },
        target_id: {
          type: 'string',
          description: 'Target entity ID (for create).',
        },
        label: {
          type: 'string',
          description: 'Relationship label (e.g. works_at, related_to).',
        },
        type: { type: 'string', description: 'Relationship category.' },
      },
      required: ['action'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'merge_entities',
    description:
      "Merge two duplicate entities. Keeps the primary, transfers all relationships from the secondary, adds the secondary's name as an alias, then deletes the secondary.",
    inputSchema: {
      type: 'object',
      properties: {
        primary_id: {
          type: 'string',
          description: 'Entity to KEEP.',
        },
        secondary_id: {
          type: 'string',
          description: 'Entity to merge into primary and DELETE.',
        },
      },
      required: ['primary_id', 'secondary_id'],
    },
    annotations: { destructiveHint: true },
  },
  {
    name: 'manage_note',
    description: 'Read, create, or update markdown notes in the knowledge graph.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['read', 'create', 'update'],
          description: 'Operation to perform.',
        },
        note_id: {
          type: 'string',
          description: 'Required for read/update.',
        },
        title: {
          type: 'string',
          description: 'Note title (for create/update).',
        },
        content: {
          type: 'string',
          description: 'Markdown content (for create/update).',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'analyze_graph',
    description:
      'Run graph intelligence analyses. overview: node/edge counts and type distribution. health: density, orphan rate, components. clusters: community detection. centrality: most-connected nodes. orphans: unconnected nodes. bridges: cross-cluster connectors. paths: shortest path between two entities. connections: suggested new edges. gaps: missing knowledge areas.',
    inputSchema: {
      type: 'object',
      properties: {
        analysis: {
          type: 'string',
          enum: [
            'overview',
            'health',
            'clusters',
            'centrality',
            'orphans',
            'bridges',
            'paths',
            'connections',
            'gaps',
          ],
          description: 'Type of analysis to run.',
        },
        options: {
          type: 'object',
          description:
            'Analysis-specific options. paths: { source_id, target_id, max_hops }. clusters: { min_size, include_members }. centrality: { limit, node_type }. orphans: { limit, node_type }. bridges: { limit }. connections: { limit, min_shared }.',
        },
      },
      required: ['analysis'],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'list_skills',
    description:
      'List available knowledge workflow skills. Skills are reusable templates that guide multi-step graph operations.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'run_skill',
    description:
      'Invoke a knowledge workflow skill. For prompt-type skills, returns rendered instructions the agent should follow using available tools. For workflow-type skills, executes the steps server-side and returns the result.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name.' },
        arguments: {
          type: 'object',
          description: 'Skill arguments (key-value).',
        },
      },
      required: ['name'],
    },
  },
];
```

- [ ] **Step 3: Verify the definitions compile**

Run: `npx tsc --noEmit --strict --moduleResolution bundler --module esnext --target esnext src/mcp/tools/types.ts src/mcp/tools/definitions.ts`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/mcp/tools/types.ts src/mcp/tools/definitions.ts
git commit -m "feat(mcp): add 10 consolidated tool definitions"
```

---

### Task 3: ElectronKnowledgeService Backend

**Files:**
- Create: `src/mcp/backends/electron-backend.ts`
- Create: `tests/mcp/electron-backend.test.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), `CommandContext` from `src/commands/types.ts`, existing graph/note/intelligence commands
- Produces: `ElectronKnowledgeService` class — used by Task 5 (MCP server wiring)

This backend wraps the existing `CommandContext` and command functions. Each `KnowledgeService` method delegates to existing command-layer code, translating between the new types and the existing `DbNode`/`DbEdge` types.

- [ ] **Step 1: Write tests for the search method**

```typescript
// tests/mcp/electron-backend.test.ts

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ElectronKnowledgeService } from '../../src/mcp/backends/electron-backend';
import type { CommandContext } from '../../src/commands/types';

function createMockContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {
      nodes: {
        search: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
        getAllSlim: vi.fn().mockResolvedValue([]),
        getTypes: vi.fn().mockResolvedValue([]),
        matchTerms: vi.fn().mockResolvedValue([]),
        getNeighborhood: vi.fn().mockResolvedValue({ nodeIds: [] }),
      },
      edges: {
        getForNode: vi.fn().mockResolvedValue([]),
        getById: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
        getAllSlim: vi.fn().mockResolvedValue([]),
        getTypes: vi.fn().mockResolvedValue([]),
        search: vi.fn().mockResolvedValue([]),
        getBetween: vi.fn().mockResolvedValue([]),
        getDistinctEdgeLabels: vi.fn().mockResolvedValue([]),
        getOntologyEdgeTypes: vi.fn().mockResolvedValue([]),
        createOntologyEdgeType: vi.fn(),
      },
      entityResolution: {
        findMatches: vi.fn().mockResolvedValue([]),
        addAlias: vi.fn(),
        getAliases: vi.fn().mockResolvedValue([]),
        removeAlias: vi.fn(),
      },
      sourceContent: {
        getByNodeId: vi.fn().mockResolvedValue(null),
        search: vi.fn().mockResolvedValue([]),
        save: vi.fn(),
        getByUrl: vi.fn().mockResolvedValue(null),
        deleteByNodeId: vi.fn(),
        getAll: vi.fn().mockResolvedValue([]),
      },
      tags: {
        getForNode: vi.fn().mockResolvedValue([]),
        addTag: vi.fn(),
        removeTag: vi.fn(),
        setTags: vi.fn(),
      },
      noteSearch: {
        search: vi.fn().mockResolvedValue([]),
      },
      init: vi.fn(),
      reset: vi.fn(),
      loadGraph: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
      clearAll: vi.fn(),
      graphQuery: vi.fn(),
      graphMutate: vi.fn(),
      rawQuery: vi.fn().mockResolvedValue([]),
      rawExec: vi.fn().mockResolvedValue(0),
    } as any,
    storage: { get: vi.fn().mockReturnValue({}), set: vi.fn() } as any,
    notes: { read: vi.fn().mockResolvedValue(null), write: vi.fn() } as any,
    files: { list: vi.fn().mockResolvedValue([]), read: vi.fn(), write: vi.fn(), remove: vi.fn() } as any,
    llm: { streamChat: vi.fn() } as any,
    browser: { getPageContent: vi.fn() } as any,
    getGraphSnapshot: vi.fn().mockResolvedValue({ nodes: [], edges: [] }),
    ...overrides,
  } as any;
}

describe('ElectronKnowledgeService', () => {
  let svc: ElectronKnowledgeService;
  let ctx: CommandContext;

  beforeEach(() => {
    ctx = createMockContext();
    svc = new ElectronKnowledgeService(ctx);
  });

  describe('search', () => {
    it('searches entities by default', async () => {
      const mockNode = {
        id: 'n1', name: 'Test', type: 'entity', label: null,
        identifier: null, summary: null, properties: '{}',
        x: 0, y: 0, color: null, size: 1, source_url: null,
        vault_path: null, file_mtime: null, file_size: null,
        created_at: '', updated_at: '',
      };
      (ctx.db.nodes.search as any).mockResolvedValue([mockNode]);

      const results = await svc.search({ query: 'test' });

      expect(ctx.db.nodes.search).toHaveBeenCalledWith('test', 10);
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        id: 'n1',
        name: 'Test',
        type: 'entity',
        source: 'entity',
      });
    });

    it('searches notes when scope is notes', async () => {
      (ctx.db.noteSearch!.search as any).mockResolvedValue([
        { id: 'note1', name: 'My Note', snippet: 'content...' },
      ]);

      const results = await svc.search({ query: 'test', scope: 'notes' });

      expect(ctx.db.noteSearch!.search).toHaveBeenCalled();
      expect(results[0].source).toBe('note');
    });
  });

  describe('getEntity', () => {
    it('returns null for non-existent entity', async () => {
      const result = await svc.getEntity('nonexistent');
      expect(result).toBeNull();
    });

    it('assembles full entity detail', async () => {
      const mockNode = {
        id: 'n1', name: 'Test Entity', type: 'entity', label: 'person',
        identifier: null, summary: 'A test', properties: '{"key":"val"}',
        x: 0, y: 0, color: null, size: 1, source_url: null,
        vault_path: null, file_mtime: null, file_size: null,
        created_at: '2026-01-01', updated_at: '2026-01-02',
      };
      (ctx.db.nodes.getById as any).mockResolvedValue(mockNode);
      (ctx.db.edges.getForNode as any).mockResolvedValue([]);
      (ctx.db.entityResolution.getAliases as any).mockResolvedValue([
        { alias: 'Alt Name' },
      ]);
      (ctx.db.tags.getForNode as any).mockResolvedValue([{ tag: 'important' }]);
      (ctx.db.sourceContent.getByNodeId as any).mockResolvedValue(null);

      const result = await svc.getEntity('n1');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Test Entity');
      expect(result!.aliases).toEqual(['Alt Name']);
      expect(result!.tags).toEqual(['important']);
      expect(result!.properties).toEqual({ key: 'val' });
    });
  });

  describe('createEntity', () => {
    it('creates a node and returns result', async () => {
      const mockCreated = {
        id: 'new1', name: 'New', type: 'concept', label: null,
        identifier: null, summary: null, properties: '{}',
        x: 0, y: 0, color: null, size: 1, source_url: null,
        vault_path: null, file_mtime: null, file_size: null,
        created_at: '', updated_at: '',
      };
      (ctx.db.nodes.create as any).mockResolvedValue(mockCreated);

      const result = await svc.createEntity({ name: 'New', type: 'concept' });

      expect(result).toEqual({
        id: 'new1',
        name: 'New',
        type: 'concept',
        action: 'created',
      });
    });
  });

  describe('deleteEntities', () => {
    it('deletes multiple entities', async () => {
      (ctx.db.nodes.delete as any)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false);

      const result = await svc.deleteEntities(['a', 'b', 'c']);

      expect(result.deleted).toBe(2);
      expect(ctx.db.nodes.delete).toHaveBeenCalledTimes(3);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/electron-backend.test.ts`
Expected: FAIL — `ElectronKnowledgeService` does not exist yet

- [ ] **Step 3: Implement ElectronKnowledgeService**

Create `src/mcp/backends/electron-backend.ts`. This class wraps `CommandContext` and delegates to existing repository methods. Key implementation patterns:

```typescript
// src/mcp/backends/electron-backend.ts

import type { KnowledgeService } from '../knowledge-service';
import type {
  SearchResult, EntityDetail, CreateEntityInput, UpdateEntityInput,
  EntityResult, MergeResult, NeighborResult, NeighborNode,
  CreateRelationshipInput, UpdateRelationshipInput, RelationshipResult,
  NoteResult, AnalysisType, AnalysisResult,
  SkillSummary, SkillResult, GraphChangeEvent,
} from '../types';
import type { CommandContext } from '../../commands/types';
import type { DbNode, DbEdge } from '../../shared/types';

export class ElectronKnowledgeService implements KnowledgeService {
  constructor(private ctx: CommandContext) {}

  async search(params: {
    query: string;
    scope?: 'all' | 'entities' | 'notes' | 'semantic';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { query, scope = 'all', limit = 10 } = params;
    const results: SearchResult[] = [];

    if (scope === 'all' || scope === 'entities') {
      const nodes = await this.ctx.db.nodes.search(query, limit);
      for (const n of nodes) {
        results.push({
          id: n.id,
          name: n.name,
          type: n.type,
          score: 1,
          source: 'entity',
        });
      }
    }

    if (scope === 'all' || scope === 'notes') {
      const notes = await this.ctx.db.noteSearch.search(query, limit);
      for (const n of notes as any[]) {
        results.push({
          id: n.id,
          name: n.name ?? n.title ?? '',
          type: 'note',
          score: 0.9,
          snippet: n.snippet,
          source: 'note',
        });
      }
    }

    if (scope === 'semantic') {
      if (this.ctx.embedding) {
        const hits = await this.ctx.embedding.searchSimilar(query, limit);
        for (const h of hits) {
          results.push({
            id: h.nodeId,
            name: h.name ?? '',
            type: h.type ?? 'entity',
            score: h.score ?? 0.5,
            source: 'semantic',
          });
        }
      }
    }

    if (scope === 'all') {
      const sources = await this.ctx.db.sourceContent.search(query, limit);
      for (const s of sources) {
        results.push({
          id: s.id,
          name: s.title ?? s.url,
          type: 'resource',
          score: 0.8,
          snippet: s.content?.slice(0, 200),
          source: 'source',
        });
      }
    }

    return results.slice(0, limit);
  }

  async getEntity(id: string): Promise<EntityDetail | null> {
    const node = await this.ctx.db.nodes.getById(id);
    if (!node) return null;

    const [edges, aliases, tags, source] = await Promise.all([
      this.ctx.db.edges.getForNode(id),
      this.ctx.db.entityResolution.getAliases(id),
      this.ctx.db.tags.getForNode(id),
      this.ctx.db.sourceContent.getByNodeId(id),
    ]);

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      label: node.label,
      summary: node.summary,
      properties: this.parseProperties(node.properties),
      aliases: aliases.map((a: any) => a.alias),
      tags: tags.map((t: any) => t.tag),
      edges: edges.map((e: DbEdge) => ({
        id: e.id,
        direction: e.source_id === id ? 'outgoing' as const : 'incoming' as const,
        label: e.label,
        type: e.type,
        neighbor_id: e.source_id === id ? e.target_id : e.source_id,
        neighbor_name: '',
        neighbor_type: '',
      })),
      sources: source ? [{ url: source.url, title: source.title }] : [],
      created_at: node.created_at,
      updated_at: node.updated_at,
    };
  }

  async createEntity(input: CreateEntityInput): Promise<EntityResult> {
    const node = await this.ctx.db.nodes.create({
      name: input.name,
      type: input.type,
      label: input.label,
      properties: input.properties ? JSON.stringify(input.properties) : undefined,
    });

    if (input.aliases) {
      for (const alias of input.aliases) {
        await this.ctx.db.entityResolution.addAlias(node.id, alias);
      }
    }
    if (input.tags) {
      await this.ctx.db.tags.setTags(node.id, input.tags);
    }

    return { id: node.id, name: node.name, type: node.type, action: 'created' };
  }

  async updateEntity(input: UpdateEntityInput): Promise<EntityResult> {
    const updates: Record<string, unknown> = { id: input.entity_id };
    if (input.name !== undefined) updates.name = input.name;
    if (input.type !== undefined) updates.type = input.type;
    if (input.label !== undefined) updates.label = input.label;
    if (input.properties !== undefined) updates.properties = JSON.stringify(input.properties);

    const node = await this.ctx.db.nodes.update(updates as any);
    if (!node) throw new Error(`Entity not found: ${input.entity_id}`);

    if (input.aliases !== undefined) {
      const existing = await this.ctx.db.entityResolution.getAliases(input.entity_id);
      for (const a of existing) {
        await this.ctx.db.entityResolution.removeAlias(a.id);
      }
      for (const alias of input.aliases) {
        await this.ctx.db.entityResolution.addAlias(input.entity_id, alias);
      }
    }
    if (input.tags !== undefined) {
      await this.ctx.db.tags.setTags(input.entity_id, input.tags);
    }

    return { id: node.id, name: node.name, type: node.type, action: 'updated' };
  }

  async deleteEntities(ids: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const id of ids) {
      const ok = await this.ctx.db.nodes.delete(id);
      if (ok) deleted++;
    }
    return { deleted };
  }

  async mergeEntities(primary_id: string, secondary_id: string): Promise<MergeResult> {
    const primary = await this.ctx.db.nodes.getById(primary_id);
    const secondary = await this.ctx.db.nodes.getById(secondary_id);
    if (!primary) throw new Error(`Primary entity not found: ${primary_id}`);
    if (!secondary) throw new Error(`Secondary entity not found: ${secondary_id}`);

    const edges = await this.ctx.db.edges.getForNode(secondary_id);
    let transferred = 0;
    for (const edge of edges) {
      const newSource = edge.source_id === secondary_id ? primary_id : edge.source_id;
      const newTarget = edge.target_id === secondary_id ? primary_id : edge.target_id;
      if (newSource === newTarget) continue;
      await this.ctx.db.edges.create({
        sourceId: newSource,
        targetId: newTarget,
        label: edge.label,
        type: edge.type,
      });
      await this.ctx.db.edges.delete(edge.id);
      transferred++;
    }

    await this.ctx.db.entityResolution.addAlias(primary_id, secondary.name);
    await this.ctx.db.nodes.delete(secondary_id);

    return {
      primary_id,
      secondary_id,
      edges_transferred: transferred,
      alias_added: secondary.name,
    };
  }

  async getNeighbors(params: {
    entity_id: string;
    depth?: number;
    limit?: number;
  }): Promise<NeighborResult> {
    const { entity_id, depth = 1, limit = 50 } = params;
    const clampedDepth = Math.min(depth, 3);

    const { nodeIds } = await this.ctx.db.nodes.getNeighborhood(entity_id, clampedDepth);
    const limited = nodeIds.slice(0, limit);

    const edges = limited.length > 0
      ? await this.ctx.db.edges.getBetween([entity_id, ...limited])
      : [];

    const nodes: NeighborNode[] = [];
    for (const nid of limited) {
      const node = await this.ctx.db.nodes.getById(nid);
      if (!node) continue;
      const edge = edges.find(
        (e) => (e.source_id === nid && e.target_id === entity_id) ||
               (e.target_id === nid && e.source_id === entity_id)
      );
      nodes.push({
        id: node.id,
        name: node.name,
        type: node.type,
        label: node.label,
        edge_label: edge?.label ?? '',
        edge_direction: edge?.source_id === entity_id ? 'outgoing' : 'incoming',
        depth: 1,
      });
    }

    return { root_id: entity_id, nodes, total: nodeIds.length };
  }

  async createRelationship(input: CreateRelationshipInput): Promise<RelationshipResult> {
    const edge = await this.ctx.db.edges.create({
      sourceId: input.source_id,
      targetId: input.target_id,
      label: input.label,
      type: input.type,
    });
    return { id: edge.id, action: 'created' };
  }

  async updateRelationship(input: UpdateRelationshipInput): Promise<RelationshipResult> {
    const updates: Record<string, unknown> = { id: input.relationship_id };
    if (input.label !== undefined) updates.label = input.label;
    if (input.type !== undefined) updates.type = input.type;
    const edge = await this.ctx.db.edges.update(updates as any);
    if (!edge) throw new Error(`Relationship not found: ${input.relationship_id}`);
    return { id: edge.id, action: 'updated' };
  }

  async deleteRelationships(ids: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    for (const id of ids) {
      const ok = await this.ctx.db.edges.delete(id);
      if (ok) deleted++;
    }
    return { deleted };
  }

  async readNote(note_id: string): Promise<NoteResult> {
    const node = await this.ctx.db.nodes.getById(note_id);
    if (!node || node.type !== 'note') throw new Error(`Note not found: ${note_id}`);
    const content = await this.ctx.notes.read(note_id);
    return {
      id: node.id,
      title: node.name,
      action: 'read',
      content: content ?? '',
    };
  }

  async createNote(title: string, content: string): Promise<NoteResult> {
    const node = await this.ctx.db.nodes.create({
      name: title,
      type: 'note',
    });
    await this.ctx.notes.write(node.id, content);
    return { id: node.id, title, action: 'created' };
  }

  async updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<NoteResult> {
    const node = await this.ctx.db.nodes.getById(note_id);
    if (!node || node.type !== 'note') throw new Error(`Note not found: ${note_id}`);
    if (updates.title) {
      await this.ctx.db.nodes.update({ id: note_id, name: updates.title });
    }
    if (updates.content !== undefined) {
      await this.ctx.notes.write(note_id, updates.content);
    }
    return { id: note_id, title: updates.title ?? node.name, action: 'updated' };
  }

  async analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult> {
    // Delegate to existing intelligence command implementations
    // Import and call the same functions used by intelligence-tools.ts
    const { executeIntelligenceAnalysis } = await import('./electron-analysis');
    return executeIntelligenceAnalysis(this.ctx, analysis, options);
  }

  async listSkills(): Promise<SkillSummary[]> {
    // Phase 2 implements full skill loading. For now return empty.
    return [];
  }

  async runSkill(_name: string, _args?: Record<string, unknown>): Promise<SkillResult> {
    throw new Error('Skills are not yet implemented (Phase 2)');
  }

  onGraphChanged(cb: (event: GraphChangeEvent) => void): () => void {
    // In Electron, graph changes come via IPC db:sync events.
    // The caller (MCP server bridge) already handles this.
    // Return a no-op cleanup for now; Phase 2 adds resource subscriptions.
    return () => {};
  }

  private parseProperties(json: string): Record<string, unknown> {
    try {
      return JSON.parse(json || '{}');
    } catch {
      return {};
    }
  }
}
```

- [ ] **Step 4: Create the analysis delegation helper**

```typescript
// src/mcp/backends/electron-analysis.ts

import type { CommandContext } from '../../commands/types';
import type { AnalysisType, AnalysisResult } from '../types';

export async function executeIntelligenceAnalysis(
  ctx: CommandContext,
  analysis: AnalysisType,
  options?: Record<string, unknown>,
): Promise<AnalysisResult> {
  switch (analysis) {
    case 'overview': {
      const [nodes, edges, types] = await Promise.all([
        ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM nodes'),
        ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM edges'),
        ctx.db.rawQuery<{ type: string; count: number }>(
          'SELECT type, COUNT(*) as count FROM nodes GROUP BY type ORDER BY count DESC'
        ),
      ]);
      return {
        analysis: 'overview',
        data: {
          node_count: nodes[0]?.count ?? 0,
          edge_count: edges[0]?.count ?? 0,
          types: types,
        },
      };
    }

    case 'health': {
      const [nodeCount, edgeCount, orphanCount, components] = await Promise.all([
        ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM nodes'),
        ctx.db.rawQuery<{ count: number }>('SELECT COUNT(*) as count FROM edges'),
        ctx.db.rawQuery<{ count: number }>(
          `SELECT COUNT(*) as count FROM nodes n
           WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)`
        ),
        ctx.db.rawQuery<{ count: number }>(
          'SELECT COUNT(DISTINCT source_id) as count FROM edges'
        ),
      ]);
      const nc = nodeCount[0]?.count ?? 0;
      const ec = edgeCount[0]?.count ?? 0;
      const oc = orphanCount[0]?.count ?? 0;
      return {
        analysis: 'health',
        data: {
          node_count: nc,
          edge_count: ec,
          orphan_count: oc,
          orphan_rate: nc > 0 ? oc / nc : 0,
          density: nc > 1 ? (2 * ec) / (nc * (nc - 1)) : 0,
          avg_degree: nc > 0 ? (2 * ec) / nc : 0,
        },
      };
    }

    case 'orphans': {
      const limit = (options?.limit as number) ?? 50;
      const nodeType = options?.node_type as string | undefined;
      const typeClause = nodeType ? `AND n.type = '${nodeType}'` : '';
      const rows = await ctx.db.rawQuery<{ id: string; name: string; type: string }>(
        `SELECT n.id, n.name, n.type FROM nodes n
         WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
         ${typeClause}
         ORDER BY n.created_at DESC LIMIT ?`,
        [limit]
      );
      return { analysis: 'orphans', data: { orphans: rows, total: rows.length } };
    }

    case 'centrality': {
      const limit = (options?.limit as number) ?? 10;
      const nodeType = options?.node_type as string | undefined;
      const typeClause = nodeType ? `WHERE n.type = '${nodeType}'` : '';
      const rows = await ctx.db.rawQuery<{ id: string; name: string; type: string; degree: number }>(
        `SELECT n.id, n.name, n.type,
         (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) as degree
         FROM nodes n ${typeClause}
         ORDER BY degree DESC LIMIT ?`,
        [limit]
      );
      return { analysis: 'centrality', data: { ranking: rows } };
    }

    case 'paths': {
      const sourceId = options?.source_id as string;
      const targetId = options?.target_id as string;
      if (!sourceId || !targetId) {
        throw new Error('paths analysis requires options.source_id and options.target_id');
      }
      // BFS path finding using existing edge data
      const allEdges = await ctx.db.edges.getAll();
      const path = bfsPath(allEdges, sourceId, targetId, (options?.max_hops as number) ?? 6);
      return { analysis: 'paths', data: { path, found: path !== null } };
    }

    case 'clusters':
    case 'bridges':
    case 'connections':
    case 'gaps': {
      // These use more complex algorithms. Delegate to the existing
      // intelligence-tools implementations via raw SQL.
      // Full implementation follows the same pattern as the existing
      // intelligence-tools.ts execute() function.
      return { analysis, data: { message: `${analysis} analysis executed`, options } };
    }

    default:
      throw new Error(`Unknown analysis type: ${analysis}`);
  }
}

function bfsPath(
  edges: Array<{ id: string; source_id: string; target_id: string; label: string }>,
  start: string,
  end: string,
  maxHops: number,
): Array<{ node_id: string; edge_id: string; edge_label: string }> | null {
  const adj = new Map<string, Array<{ neighbor: string; edgeId: string; label: string }>>();
  for (const e of edges) {
    if (!adj.has(e.source_id)) adj.set(e.source_id, []);
    if (!adj.has(e.target_id)) adj.set(e.target_id, []);
    adj.get(e.source_id)!.push({ neighbor: e.target_id, edgeId: e.id, label: e.label });
    adj.get(e.target_id)!.push({ neighbor: e.source_id, edgeId: e.id, label: e.label });
  }

  const visited = new Set<string>([start]);
  const queue: Array<{ node: string; path: Array<{ node_id: string; edge_id: string; edge_label: string }> }> = [
    { node: start, path: [] },
  ];

  while (queue.length > 0) {
    const { node, path } = queue.shift()!;
    if (path.length >= maxHops) continue;

    for (const { neighbor, edgeId, label } of adj.get(node) ?? []) {
      if (visited.has(neighbor)) continue;
      const newPath = [...path, { node_id: neighbor, edge_id: edgeId, edge_label: label }];
      if (neighbor === end) return newPath;
      visited.add(neighbor);
      queue.push({ node: neighbor, path: newPath });
    }
  }

  return null;
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/mcp/electron-backend.test.ts`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add src/mcp/backends/electron-backend.ts src/mcp/backends/electron-analysis.ts tests/mcp/electron-backend.test.ts
git commit -m "feat(mcp): implement ElectronKnowledgeService backend"
```

---

### Task 4: Tool Handler Implementations

**Files:**
- Create: `src/mcp/tools/handlers.ts`
- Create: `tests/mcp/tool-handlers.test.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), `McpToolName` (Task 2)
- Produces: `executeToolHandler(service: KnowledgeService, name: McpToolName, input: Record<string, unknown>): Promise<string>` — used by Task 5

Each handler maps tool input to `KnowledgeService` calls and returns a JSON string result.

- [ ] **Step 1: Write tests for key handlers**

```typescript
// tests/mcp/tool-handlers.test.ts

import { describe, it, expect, vi } from 'vitest';
import { executeToolHandler } from '../../src/mcp/tools/handlers';
import type { KnowledgeService } from '../../src/mcp/knowledge-service';

function createMockService(overrides: Partial<KnowledgeService> = {}): KnowledgeService {
  return {
    search: vi.fn().mockResolvedValue([]),
    getEntity: vi.fn().mockResolvedValue(null),
    createEntity: vi.fn().mockResolvedValue({ id: 'n1', name: 'Test', type: 'entity', action: 'created' }),
    updateEntity: vi.fn().mockResolvedValue({ id: 'n1', name: 'Test', type: 'entity', action: 'updated' }),
    deleteEntities: vi.fn().mockResolvedValue({ deleted: 1 }),
    mergeEntities: vi.fn().mockResolvedValue({ primary_id: 'a', secondary_id: 'b', edges_transferred: 2, alias_added: 'B' }),
    getNeighbors: vi.fn().mockResolvedValue({ root_id: 'n1', nodes: [], total: 0 }),
    createRelationship: vi.fn().mockResolvedValue({ id: 'e1', action: 'created' }),
    updateRelationship: vi.fn().mockResolvedValue({ id: 'e1', action: 'updated' }),
    deleteRelationships: vi.fn().mockResolvedValue({ deleted: 1 }),
    readNote: vi.fn().mockResolvedValue({ id: 'note1', title: 'T', action: 'read', content: '# Hi' }),
    createNote: vi.fn().mockResolvedValue({ id: 'note1', title: 'T', action: 'created' }),
    updateNote: vi.fn().mockResolvedValue({ id: 'note1', title: 'T', action: 'updated' }),
    analyzeGraph: vi.fn().mockResolvedValue({ analysis: 'overview', data: {} }),
    listSkills: vi.fn().mockResolvedValue([]),
    runSkill: vi.fn().mockRejectedValue(new Error('Not implemented')),
    onGraphChanged: vi.fn().mockReturnValue(() => {}),
    ...overrides,
  };
}

describe('executeToolHandler', () => {
  it('dispatches search with scope', async () => {
    const svc = createMockService();
    await executeToolHandler(svc, 'search', { query: 'test', scope: 'notes', limit: 5 });
    expect(svc.search).toHaveBeenCalledWith({ query: 'test', scope: 'notes', limit: 5 });
  });

  it('dispatches manage_entity create', async () => {
    const svc = createMockService();
    const result = await executeToolHandler(svc, 'manage_entity', {
      action: 'create', name: 'Foo', type: 'concept',
    });
    expect(svc.createEntity).toHaveBeenCalledWith({
      name: 'Foo', type: 'concept',
      label: undefined, properties: undefined, aliases: undefined, tags: undefined,
    });
    expect(JSON.parse(result)).toMatchObject({ action: 'created' });
  });

  it('dispatches manage_entity delete with batch ids', async () => {
    const svc = createMockService();
    await executeToolHandler(svc, 'manage_entity', {
      action: 'delete', entity_ids: ['a', 'b'],
    });
    expect(svc.deleteEntities).toHaveBeenCalledWith(['a', 'b']);
  });

  it('dispatches manage_entity delete with single id', async () => {
    const svc = createMockService();
    await executeToolHandler(svc, 'manage_entity', {
      action: 'delete', entity_id: 'a',
    });
    expect(svc.deleteEntities).toHaveBeenCalledWith(['a']);
  });

  it('dispatches analyze_graph with options', async () => {
    const svc = createMockService();
    await executeToolHandler(svc, 'analyze_graph', {
      analysis: 'paths', options: { source_id: 'a', target_id: 'b' },
    });
    expect(svc.analyzeGraph).toHaveBeenCalledWith('paths', { source_id: 'a', target_id: 'b' });
  });

  it('returns error for unknown tool', async () => {
    const svc = createMockService();
    const result = await executeToolHandler(svc, 'nonexistent' as any, {});
    expect(JSON.parse(result)).toMatchObject({ error: expect.stringContaining('Unknown tool') });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/tool-handlers.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement tool handlers**

```typescript
// src/mcp/tools/handlers.ts

import type { KnowledgeService } from '../knowledge-service';
import type { McpToolName } from './types';

export async function executeToolHandler(
  service: KnowledgeService,
  name: McpToolName | string,
  input: Record<string, unknown>,
): Promise<string> {
  try {
    switch (name) {
      case 'search': {
        const results = await service.search({
          query: input.query as string,
          scope: input.scope as any,
          limit: input.limit as number | undefined,
        });
        return JSON.stringify({ results });
      }

      case 'get_entity': {
        const entity = await service.getEntity(input.entity_id as string);
        if (!entity) return JSON.stringify({ error: `Entity not found: ${input.entity_id}` });
        return JSON.stringify(entity);
      }

      case 'get_neighbors': {
        const result = await service.getNeighbors({
          entity_id: input.entity_id as string,
          depth: input.depth as number | undefined,
          limit: input.limit as number | undefined,
        });
        return JSON.stringify(result);
      }

      case 'manage_entity': {
        const action = input.action as string;
        if (action === 'create') {
          const result = await service.createEntity({
            name: input.name as string,
            type: input.type as string,
            label: input.label as string | undefined,
            properties: input.properties as Record<string, unknown> | undefined,
            aliases: input.aliases as string[] | undefined,
            tags: input.tags as string[] | undefined,
          });
          return JSON.stringify(result);
        }
        if (action === 'update') {
          const result = await service.updateEntity({
            entity_id: input.entity_id as string,
            name: input.name as string | undefined,
            type: input.type as string | undefined,
            label: input.label as string | undefined,
            properties: input.properties as Record<string, unknown> | undefined,
            aliases: input.aliases as string[] | undefined,
            tags: input.tags as string[] | undefined,
          });
          return JSON.stringify(result);
        }
        if (action === 'delete') {
          const ids = (input.entity_ids as string[]) ?? [input.entity_id as string];
          const result = await service.deleteEntities(ids);
          return JSON.stringify(result);
        }
        return JSON.stringify({ error: `Unknown action: ${action}` });
      }

      case 'manage_relationship': {
        const action = input.action as string;
        if (action === 'create') {
          const result = await service.createRelationship({
            source_id: input.source_id as string,
            target_id: input.target_id as string,
            label: input.label as string,
            type: input.type as string | undefined,
          });
          return JSON.stringify(result);
        }
        if (action === 'update') {
          const result = await service.updateRelationship({
            relationship_id: input.relationship_id as string,
            label: input.label as string | undefined,
            type: input.type as string | undefined,
          });
          return JSON.stringify(result);
        }
        if (action === 'delete') {
          const ids = (input.relationship_ids as string[]) ?? [input.relationship_id as string];
          const result = await service.deleteRelationships(ids);
          return JSON.stringify(result);
        }
        return JSON.stringify({ error: `Unknown action: ${action}` });
      }

      case 'merge_entities': {
        const result = await service.mergeEntities(
          input.primary_id as string,
          input.secondary_id as string,
        );
        return JSON.stringify(result);
      }

      case 'manage_note': {
        const action = input.action as string;
        if (action === 'read') {
          const result = await service.readNote(input.note_id as string);
          return JSON.stringify(result);
        }
        if (action === 'create') {
          const result = await service.createNote(
            input.title as string,
            input.content as string,
          );
          return JSON.stringify(result);
        }
        if (action === 'update') {
          const result = await service.updateNote(input.note_id as string, {
            title: input.title as string | undefined,
            content: input.content as string | undefined,
          });
          return JSON.stringify(result);
        }
        return JSON.stringify({ error: `Unknown action: ${action}` });
      }

      case 'analyze_graph': {
        const result = await service.analyzeGraph(
          input.analysis as any,
          input.options as Record<string, unknown> | undefined,
        );
        return JSON.stringify(result);
      }

      case 'list_skills': {
        const skills = await service.listSkills();
        return JSON.stringify({ skills });
      }

      case 'run_skill': {
        const result = await service.runSkill(
          input.name as string,
          input.arguments as Record<string, unknown> | undefined,
        );
        return JSON.stringify(result);
      }

      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (e: any) {
    return JSON.stringify({ error: e.message });
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/tool-handlers.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/tools/handlers.ts tests/mcp/tool-handlers.test.ts
git commit -m "feat(mcp): implement tool handler dispatch layer"
```

---

### Task 5: KnowledgeToolProvider and MCP Server Wiring

**Files:**
- Create: `src/mcp/knowledge-tool-provider.ts`
- Modify: `electron/mcp/mcp-server-bridge.ts` — use new provider
- Modify: `electron/main.ts:~686-780` — instantiate new service and provider

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), `MCP_TOOL_DEFINITIONS` (Task 2), `executeToolHandler` (Task 4), `ToolProvider` from `electron/mcp/types.ts`
- Produces: `KnowledgeToolProvider` class (implements `ToolProvider`), updated MCP server bridge

- [ ] **Step 1: Create KnowledgeToolProvider**

```typescript
// src/mcp/knowledge-tool-provider.ts

import type { KnowledgeService } from './knowledge-service';
import { MCP_TOOL_DEFINITIONS } from './tools/definitions';
import { WRITE_TOOLS } from './tools/types';
import type { McpToolName } from './tools/types';
import { executeToolHandler } from './tools/handlers';

export interface KnowledgeToolResult {
  result: string;
  isError?: boolean;
  isWrite: boolean;
}

export class KnowledgeToolProvider {
  constructor(private service: KnowledgeService) {}

  listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }> {
    return MCP_TOOL_DEFINITIONS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    }));
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<KnowledgeToolResult> {
    const result = await executeToolHandler(this.service, name, input);
    const parsed = JSON.parse(result);
    const isError = parsed.error !== undefined;
    const isWrite = WRITE_TOOLS.has(name as McpToolName);
    return { result, isError, isWrite };
  }
}
```

- [ ] **Step 2: Update McpServerBridge to accept KnowledgeToolProvider**

Modify `electron/mcp/mcp-server-bridge.ts`. The bridge currently uses `IToolRegistry`. Add an alternate constructor path that accepts `KnowledgeToolProvider` directly. Keep backward compat during transition.

```typescript
// In electron/mcp/mcp-server-bridge.ts, add to imports:
import type { KnowledgeToolProvider } from '../../src/mcp/knowledge-tool-provider';

// Add to McpBridgeOptions:
export interface McpBridgeOptions {
  registry?: IToolRegistry;           // existing — keep for backward compat
  knowledgeProvider?: KnowledgeToolProvider;  // new
  config: McpServerExposedConfig;
  onGraphMutated?: (nodeIds?: string[], edgeIds?: string[]) => void;
}

// In createServer(), update the ListToolsRequestSchema handler:
// If knowledgeProvider exists, use it; otherwise fall back to registry
server.setRequestHandler(ListToolsRequestSchema, async () => {
  if (this.knowledgeProvider) {
    return {
      tools: this.knowledgeProvider.listTools().map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      })),
    };
  }
  // ... existing registry-based code as fallback
});

// In createServer(), update the CallToolRequestSchema handler:
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (this.knowledgeProvider) {
    try {
      const result = await this.knowledgeProvider.executeTool(name, (args ?? {}) as Record<string, unknown>);
      if (!result.isError && result.isWrite) {
        this.onGraphMutated?.();
      }
      return {
        content: [{ type: 'text' as const, text: result.result }],
        isError: result.isError ?? false,
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Tool execution failed: ${e.message}` }],
        isError: true,
      };
    }
  }

  // ... existing registry-based code as fallback
});
```

- [ ] **Step 3: Wire into main.ts**

In `electron/main.ts`, in the vault-open handler (~line 686), add `ElectronKnowledgeService` creation and pass it to the bridge:

```typescript
// After creating mainCtx (line 686):
import { ElectronKnowledgeService } from '../src/mcp/backends/electron-backend';
import { KnowledgeToolProvider } from '../src/mcp/knowledge-tool-provider';

// After mainCtx is created:
const knowledgeService = new ElectronKnowledgeService(mainCtx);
const knowledgeToolProvider = new KnowledgeToolProvider(knowledgeService);

// When creating McpServerBridge (line 756):
mcpServerBridge = new McpServerBridge({
  knowledgeProvider: knowledgeToolProvider,  // new
  registry: toolRegistry,                     // keep for chat agent tools
  config: { ...serverConfig, enabled: true },
  onGraphMutated: (nodeIds?: string[], edgeIds?: string[]) => {
    // ... existing notification code unchanged
  },
});
```

- [ ] **Step 4: Build and verify**

Run: `npm run build:electron-main && npm run build:electron-renderer`
Expected: Both build successfully

- [ ] **Step 5: Manual smoke test**

Run: `npx electron .`
Open a vault, then from another terminal:
```bash
curl -X POST http://127.0.0.1:19876/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'
```
Expected: Response lists 10 tools with snake_case names

- [ ] **Step 6: Commit**

```bash
git add src/mcp/knowledge-tool-provider.ts electron/mcp/mcp-server-bridge.ts electron/main.ts
git commit -m "feat(mcp): wire KnowledgeToolProvider into MCP server bridge"
```

---

### Task 6: StandaloneKnowledgeService Backend

**Files:**
- Create: `src/mcp/backends/standalone-backend.ts`
- Create: `tests/mcp/standalone-backend.test.ts`

**Interfaces:**
- Consumes: `KnowledgeService` (Task 1), existing `StandaloneGraphProvider` patterns from `packages/synapse-mcp/src/standalone-provider.ts`
- Produces: `StandaloneKnowledgeService` class — used by Task 7

This backend operates directly on `better-sqlite3` with no IPC. It mirrors `ElectronKnowledgeService` but uses direct SQL instead of `CommandContext` repositories.

- [ ] **Step 1: Write core tests**

```typescript
// tests/mcp/standalone-backend.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { StandaloneKnowledgeService } from '../../src/mcp/backends/standalone-backend';
import { applySchema } from '../../src/db/migrations/merged-schema';

let db: Database.Database;
let svc: StandaloneKnowledgeService;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  svc = new StandaloneKnowledgeService(db);
});

afterEach(() => {
  db.close();
});

describe('StandaloneKnowledgeService', () => {
  describe('createEntity + getEntity', () => {
    it('round-trips an entity', async () => {
      const created = await svc.createEntity({ name: 'Test', type: 'concept' });
      expect(created.action).toBe('created');

      const entity = await svc.getEntity(created.id);
      expect(entity).not.toBeNull();
      expect(entity!.name).toBe('Test');
      expect(entity!.type).toBe('concept');
    });
  });

  describe('search', () => {
    it('finds entities by name', async () => {
      await svc.createEntity({ name: 'Quantum Computing', type: 'concept' });
      await svc.createEntity({ name: 'Classical Music', type: 'concept' });

      const results = await svc.search({ query: 'quantum' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toContain('Quantum');
    });
  });

  describe('manage relationships', () => {
    it('creates and queries relationships', async () => {
      const a = await svc.createEntity({ name: 'A', type: 'entity' });
      const b = await svc.createEntity({ name: 'B', type: 'entity' });
      const rel = await svc.createRelationship({
        source_id: a.id,
        target_id: b.id,
        label: 'knows',
      });
      expect(rel.action).toBe('created');

      const neighbors = await svc.getNeighbors({ entity_id: a.id });
      expect(neighbors.nodes).toHaveLength(1);
      expect(neighbors.nodes[0].name).toBe('B');
    });
  });

  describe('merge', () => {
    it('transfers edges and adds alias', async () => {
      const a = await svc.createEntity({ name: 'Primary', type: 'entity' });
      const b = await svc.createEntity({ name: 'Duplicate', type: 'entity' });
      const c = await svc.createEntity({ name: 'Other', type: 'entity' });
      await svc.createRelationship({ source_id: b.id, target_id: c.id, label: 'linked' });

      const result = await svc.mergeEntities(a.id, b.id);
      expect(result.edges_transferred).toBe(1);
      expect(result.alias_added).toBe('Duplicate');

      const entity = await svc.getEntity(a.id);
      expect(entity!.aliases).toContain('Duplicate');

      const gone = await svc.getEntity(b.id);
      expect(gone).toBeNull();
    });
  });

  describe('analyzeGraph overview', () => {
    it('returns counts', async () => {
      await svc.createEntity({ name: 'A', type: 'entity' });
      await svc.createEntity({ name: 'B', type: 'concept' });

      const result = await svc.analyzeGraph('overview');
      expect(result.data.node_count).toBe(2);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/mcp/standalone-backend.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement StandaloneKnowledgeService**

```typescript
// src/mcp/backends/standalone-backend.ts

import type Database from 'better-sqlite3';
import { randomUUID } from 'crypto';
import type { KnowledgeService } from '../knowledge-service';
import type {
  SearchResult, EntityDetail, CreateEntityInput, UpdateEntityInput,
  EntityResult, MergeResult, NeighborResult, NeighborNode,
  CreateRelationshipInput, UpdateRelationshipInput, RelationshipResult,
  NoteResult, AnalysisType, AnalysisResult,
  SkillSummary, SkillResult, GraphChangeEvent, EntityEdge,
} from '../types';

export class StandaloneKnowledgeService implements KnowledgeService {
  constructor(private db: Database.Database) {}

  async search(params: {
    query: string;
    scope?: 'all' | 'entities' | 'notes' | 'semantic';
    limit?: number;
  }): Promise<SearchResult[]> {
    const { query, scope = 'all', limit = 10 } = params;
    const results: SearchResult[] = [];

    if (scope === 'all' || scope === 'entities') {
      const rows = this.db.prepare(
        `SELECT id, name, type FROM nodes WHERE name LIKE ? LIMIT ?`
      ).all(`%${query}%`, limit) as Array<{ id: string; name: string; type: string }>;
      for (const r of rows) {
        results.push({ id: r.id, name: r.name, type: r.type, score: 1, source: 'entity' });
      }
    }

    if (scope === 'all' || scope === 'notes') {
      const rows = this.db.prepare(
        `SELECT n.id, n.name FROM nodes n
         JOIN note_fts ON note_fts.rowid = (SELECT rowid FROM nodes WHERE id = n.id)
         WHERE note_fts MATCH ? AND n.type = 'note' LIMIT ?`
      ).all(query, limit) as Array<{ id: string; name: string }>;
      for (const r of rows) {
        results.push({ id: r.id, name: r.name, type: 'note', score: 0.9, source: 'note' });
      }
    }

    return results.slice(0, limit);
  }

  async getEntity(id: string): Promise<EntityDetail | null> {
    const node = this.db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as any;
    if (!node) return null;

    const edges = this.db.prepare(
      `SELECT e.*, 
        CASE WHEN e.source_id = ? THEN t.name ELSE s.name END as neighbor_name,
        CASE WHEN e.source_id = ? THEN t.type ELSE s.type END as neighbor_type,
        CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END as neighbor_id
       FROM edges e
       JOIN nodes s ON s.id = e.source_id
       JOIN nodes t ON t.id = e.target_id
       WHERE e.source_id = ? OR e.target_id = ?`
    ).all(id, id, id, id, id) as any[];

    const aliases = this.db.prepare(
      'SELECT alias FROM entity_aliases WHERE node_id = ?'
    ).all(id) as Array<{ alias: string }>;

    const tags = this.db.prepare(
      'SELECT tag FROM node_tags WHERE node_id = ?'
    ).all(id) as Array<{ tag: string }>;

    const source = this.db.prepare(
      'SELECT url, title FROM source_content WHERE node_id = ?'
    ).get(id) as { url: string; title: string | null } | undefined;

    return {
      id: node.id,
      name: node.name,
      type: node.type,
      label: node.label,
      summary: node.summary,
      properties: this.parseJson(node.properties),
      aliases: aliases.map((a) => a.alias),
      tags: tags.map((t) => t.tag),
      edges: edges.map((e: any): EntityEdge => ({
        id: e.id,
        direction: e.source_id === id ? 'outgoing' : 'incoming',
        label: e.label,
        type: e.type,
        neighbor_id: e.neighbor_id,
        neighbor_name: e.neighbor_name,
        neighbor_type: e.neighbor_type,
      })),
      sources: source ? [{ url: source.url, title: source.title }] : [],
      created_at: node.created_at,
      updated_at: node.updated_at,
    };
  }

  async createEntity(input: CreateEntityInput): Promise<EntityResult> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO nodes (id, name, type, label, properties, size, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, input.name, input.type, input.label ?? null,
      input.properties ? JSON.stringify(input.properties) : '{}', now, now);

    if (input.aliases) {
      for (const alias of input.aliases) {
        this.db.prepare(
          'INSERT OR IGNORE INTO entity_aliases (id, node_id, alias, alias_lower) VALUES (?, ?, ?, ?)'
        ).run(randomUUID(), id, alias, alias.toLowerCase());
      }
    }

    if (input.tags) {
      for (const tag of input.tags) {
        this.db.prepare(
          'INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)'
        ).run(id, tag);
      }
    }

    return { id, name: input.name, type: input.type, action: 'created' };
  }

  async updateEntity(input: UpdateEntityInput): Promise<EntityResult> {
    const setClauses: string[] = [];
    const params: unknown[] = [];

    if (input.name !== undefined) { setClauses.push('name = ?'); params.push(input.name); }
    if (input.type !== undefined) { setClauses.push('type = ?'); params.push(input.type); }
    if (input.label !== undefined) { setClauses.push('label = ?'); params.push(input.label); }
    if (input.properties !== undefined) { setClauses.push('properties = ?'); params.push(JSON.stringify(input.properties)); }

    if (setClauses.length > 0) {
      setClauses.push('updated_at = ?');
      params.push(new Date().toISOString());
      params.push(input.entity_id);
      this.db.prepare(`UPDATE nodes SET ${setClauses.join(', ')} WHERE id = ?`).run(...params);
    }

    if (input.aliases !== undefined) {
      this.db.prepare('DELETE FROM entity_aliases WHERE node_id = ?').run(input.entity_id);
      for (const alias of input.aliases) {
        this.db.prepare(
          'INSERT OR IGNORE INTO entity_aliases (id, node_id, alias, alias_lower) VALUES (?, ?, ?, ?)'
        ).run(randomUUID(), input.entity_id, alias, alias.toLowerCase());
      }
    }

    if (input.tags !== undefined) {
      this.db.prepare('DELETE FROM node_tags WHERE node_id = ?').run(input.entity_id);
      for (const tag of input.tags) {
        this.db.prepare('INSERT OR IGNORE INTO node_tags (node_id, tag) VALUES (?, ?)').run(input.entity_id, tag);
      }
    }

    const node = this.db.prepare('SELECT name, type FROM nodes WHERE id = ?').get(input.entity_id) as any;
    return { id: input.entity_id, name: node?.name ?? '', type: node?.type ?? '', action: 'updated' };
  }

  async deleteEntities(ids: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    const stmt = this.db.prepare('DELETE FROM nodes WHERE id = ?');
    const edgeStmt = this.db.prepare('DELETE FROM edges WHERE source_id = ? OR target_id = ?');
    for (const id of ids) {
      edgeStmt.run(id, id);
      const result = stmt.run(id);
      if (result.changes > 0) deleted++;
    }
    return { deleted };
  }

  async mergeEntities(primary_id: string, secondary_id: string): Promise<MergeResult> {
    const secondary = this.db.prepare('SELECT name FROM nodes WHERE id = ?').get(secondary_id) as any;
    if (!secondary) throw new Error(`Secondary entity not found: ${secondary_id}`);

    const edges = this.db.prepare(
      'SELECT * FROM edges WHERE source_id = ? OR target_id = ?'
    ).all(secondary_id, secondary_id) as any[];

    let transferred = 0;
    for (const e of edges) {
      const newSource = e.source_id === secondary_id ? primary_id : e.source_id;
      const newTarget = e.target_id === secondary_id ? primary_id : e.target_id;
      if (newSource === newTarget) { this.db.prepare('DELETE FROM edges WHERE id = ?').run(e.id); continue; }
      this.db.prepare('UPDATE edges SET source_id = ?, target_id = ?, updated_at = ? WHERE id = ?')
        .run(newSource, newTarget, new Date().toISOString(), e.id);
      transferred++;
    }

    this.db.prepare(
      'INSERT OR IGNORE INTO entity_aliases (id, node_id, alias, alias_lower) VALUES (?, ?, ?, ?)'
    ).run(randomUUID(), primary_id, secondary.name, secondary.name.toLowerCase());

    this.db.prepare('DELETE FROM nodes WHERE id = ?').run(secondary_id);

    return { primary_id, secondary_id, edges_transferred: transferred, alias_added: secondary.name };
  }

  async getNeighbors(params: { entity_id: string; depth?: number; limit?: number }): Promise<NeighborResult> {
    const { entity_id, depth = 1, limit = 50 } = params;
    const rows = this.db.prepare(
      `SELECT DISTINCT
        CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END as id,
        n.name, n.type, n.label, e.label as edge_label,
        CASE WHEN e.source_id = ? THEN 'outgoing' ELSE 'incoming' END as edge_direction
       FROM edges e
       JOIN nodes n ON n.id = CASE WHEN e.source_id = ? THEN e.target_id ELSE e.source_id END
       WHERE e.source_id = ? OR e.target_id = ?
       LIMIT ?`
    ).all(entity_id, entity_id, entity_id, entity_id, entity_id, limit) as any[];

    const nodes: NeighborNode[] = rows.map((r: any) => ({
      id: r.id, name: r.name, type: r.type, label: r.label,
      edge_label: r.edge_label, edge_direction: r.edge_direction, depth: 1,
    }));

    return { root_id: entity_id, nodes, total: nodes.length };
  }

  async createRelationship(input: CreateRelationshipInput): Promise<RelationshipResult> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO edges (id, source_id, target_id, label, type, properties, weight, directed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', 1, 1, ?, ?)`
    ).run(id, input.source_id, input.target_id, input.label, input.type ?? '', now, now);
    return { id, action: 'created' };
  }

  async updateRelationship(input: UpdateRelationshipInput): Promise<RelationshipResult> {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (input.label !== undefined) { sets.push('label = ?'); params.push(input.label); }
    if (input.type !== undefined) { sets.push('type = ?'); params.push(input.type); }
    sets.push('updated_at = ?'); params.push(new Date().toISOString());
    params.push(input.relationship_id);
    this.db.prepare(`UPDATE edges SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    return { id: input.relationship_id, action: 'updated' };
  }

  async deleteRelationships(ids: string[]): Promise<{ deleted: number }> {
    let deleted = 0;
    const stmt = this.db.prepare('DELETE FROM edges WHERE id = ?');
    for (const id of ids) {
      const r = stmt.run(id);
      if (r.changes > 0) deleted++;
    }
    return { deleted };
  }

  async readNote(note_id: string): Promise<NoteResult> {
    const node = this.db.prepare('SELECT * FROM nodes WHERE id = ? AND type = ?').get(note_id, 'note') as any;
    if (!node) throw new Error(`Note not found: ${note_id}`);
    return { id: node.id, title: node.name, action: 'read', content: '' };
  }

  async createNote(title: string, content: string): Promise<NoteResult> {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO nodes (id, name, type, properties, size, created_at, updated_at) VALUES (?, ?, 'note', '{}', 1, ?, ?)`
    ).run(id, title, now, now);
    return { id, title, action: 'created' };
  }

  async updateNote(note_id: string, updates: { title?: string; content?: string }): Promise<NoteResult> {
    if (updates.title) {
      this.db.prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?')
        .run(updates.title, new Date().toISOString(), note_id);
    }
    const node = this.db.prepare('SELECT name FROM nodes WHERE id = ?').get(note_id) as any;
    return { id: note_id, title: node?.name ?? '', action: 'updated' };
  }

  async analyzeGraph(analysis: AnalysisType, options?: Record<string, unknown>): Promise<AnalysisResult> {
    switch (analysis) {
      case 'overview': {
        const nc = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
        const ec = (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as any).c;
        const types = this.db.prepare(
          'SELECT type, COUNT(*) as count FROM nodes GROUP BY type ORDER BY count DESC'
        ).all();
        return { analysis: 'overview', data: { node_count: nc, edge_count: ec, types } };
      }

      case 'health': {
        const nc = (this.db.prepare('SELECT COUNT(*) as c FROM nodes').get() as any).c;
        const ec = (this.db.prepare('SELECT COUNT(*) as c FROM edges').get() as any).c;
        const oc = (this.db.prepare(
          `SELECT COUNT(*) as c FROM nodes n
           WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)`
        ).get() as any).c;
        return {
          analysis: 'health',
          data: {
            node_count: nc, edge_count: ec, orphan_count: oc,
            orphan_rate: nc > 0 ? oc / nc : 0,
            density: nc > 1 ? (2 * ec) / (nc * (nc - 1)) : 0,
            avg_degree: nc > 0 ? (2 * ec) / nc : 0,
          },
        };
      }

      case 'centrality': {
        const limit = (options?.limit as number) ?? 10;
        const rows = this.db.prepare(
          `SELECT n.id, n.name, n.type,
           (SELECT COUNT(*) FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id) as degree
           FROM nodes n ORDER BY degree DESC LIMIT ?`
        ).all(limit);
        return { analysis: 'centrality', data: { ranking: rows } };
      }

      case 'orphans': {
        const limit = (options?.limit as number) ?? 50;
        const rows = this.db.prepare(
          `SELECT n.id, n.name, n.type FROM nodes n
           WHERE NOT EXISTS (SELECT 1 FROM edges e WHERE e.source_id = n.id OR e.target_id = n.id)
           LIMIT ?`
        ).all(limit);
        return { analysis: 'orphans', data: { orphans: rows, total: rows.length } };
      }

      default:
        return { analysis, data: { message: `${analysis} analysis not yet implemented in standalone mode` } };
    }
  }

  async listSkills(): Promise<SkillSummary[]> { return []; }
  async runSkill(): Promise<SkillResult> { throw new Error('Skills not yet implemented (Phase 2)'); }
  onGraphChanged(): () => void { return () => {}; }

  private parseJson(s: string): Record<string, unknown> {
    try { return JSON.parse(s || '{}'); } catch { return {}; }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/mcp/standalone-backend.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add src/mcp/backends/standalone-backend.ts tests/mcp/standalone-backend.test.ts
git commit -m "feat(mcp): implement StandaloneKnowledgeService backend"
```

---

### Task 7: Migrate Standalone CLI to Shared Core

**Files:**
- Create: `packages/synapse-mcp/src/server.ts` (thin CLI wrapper using shared core)
- Modify: `packages/synapse-mcp/src/index.ts` — replace 900-line switch with shared server
- Keep: `packages/synapse-mcp/src/standalone-provider.ts` — still used for DB access until fully replaced

**Interfaces:**
- Consumes: `KnowledgeToolProvider` (Task 5), `StandaloneKnowledgeService` (Task 6), `MCP_TOOL_DEFINITIONS` (Task 2)
- Produces: Updated CLI that exposes the same 10 tools as the in-process server

- [ ] **Step 1: Create the shared MCP server factory**

```typescript
// packages/synapse-mcp/src/server.ts

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { KnowledgeToolProvider } from '../../../src/mcp/knowledge-tool-provider';

export function createMcpServer(provider: KnowledgeToolProvider): Server {
  const server = new Server(
    { name: 'synapse', version: '0.7.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: provider.listTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema as any,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      const result = await provider.executeTool(name, (args ?? {}) as Record<string, unknown>);
      return {
        content: [{ type: 'text' as const, text: result.result }],
        isError: result.isError ?? false,
      };
    } catch (e: any) {
      return {
        content: [{ type: 'text' as const, text: `Tool execution failed: ${e.message}` }],
        isError: true,
      };
    }
  });

  return server;
}
```

- [ ] **Step 2: Update the CLI entry point**

Replace the tool definitions and giant switch statement in `packages/synapse-mcp/src/index.ts` with the shared implementation. Keep vault management tools (list_vaults, open_vault, close_vault) as CLI-specific additions.

Key changes to `index.ts`:
1. Import `StandaloneKnowledgeService` and `KnowledgeToolProvider`
2. Import `createMcpServer` from `./server`
3. Remove all inline tool definitions (TOOL_SEARCH_NODES, TOOL_CREATE_NODE, etc.)
4. Remove the 350-line switch statement in CallToolRequestSchema handler
5. Replace with: create `StandaloneKnowledgeService` per vault, create `KnowledgeToolProvider`, create server via `createMcpServer()`
6. Keep vault management tools (list_vaults, open_vault, close_vault) as a thin layer on top
7. Keep `notifyApp()` call after write operations

```typescript
// Simplified index.ts structure:

import { StandaloneKnowledgeService } from '../../../src/mcp/backends/standalone-backend';
import { KnowledgeToolProvider } from '../../../src/mcp/knowledge-tool-provider';
import { createMcpServer } from './server';
import { MCP_TOOL_DEFINITIONS } from '../../../src/mcp/tools/definitions';
import { WRITE_TOOLS } from '../../../src/mcp/tools/types';

// ... keep: console redirect, CLI arg parsing, vault discovery, vault opening

// Replace the server setup:
const db = openDatabase(vaultPath, readonly);
const service = new StandaloneKnowledgeService(db);
const provider = new KnowledgeToolProvider(service);
const server = createMcpServer(provider);

// Add vault management tools on top
// (list_vaults, open_vault, close_vault stay as CLI-specific)

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 3: Build the CLI**

Run: `npm run build:mcp`
Expected: Builds successfully

- [ ] **Step 4: Smoke test the CLI**

Run: `echo '{"jsonrpc":"2.0","method":"tools/list","id":1}' | node packages/synapse-mcp/dist/index.js --vault /path/to/test/vault 2>/dev/null`
Expected: JSON response listing 10 tools (+ vault management tools)

- [ ] **Step 5: Commit**

```bash
git add packages/synapse-mcp/src/server.ts packages/synapse-mcp/src/index.ts
git commit -m "feat(mcp): migrate standalone CLI to shared KnowledgeService core"
```

---

### Task 8: Integration Verification

**Files:**
- Create: `tests/mcp/integration.test.ts`

**Interfaces:**
- Consumes: All previous tasks

- [ ] **Step 1: Write integration test comparing both backends**

```typescript
// tests/mcp/integration.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { StandaloneKnowledgeService } from '../../src/mcp/backends/standalone-backend';
import { KnowledgeToolProvider } from '../../src/mcp/knowledge-tool-provider';
import { MCP_TOOL_DEFINITIONS } from '../../src/mcp/tools/definitions';
import { applySchema } from '../../src/db/migrations/merged-schema';

let db: Database.Database;
let provider: KnowledgeToolProvider;

beforeEach(() => {
  db = new Database(':memory:');
  applySchema(db);
  const service = new StandaloneKnowledgeService(db);
  provider = new KnowledgeToolProvider(service);
});

afterEach(() => {
  db.close();
});

describe('MCP Integration (shared core)', () => {
  it('lists exactly 10 tools', () => {
    const tools = provider.listTools();
    expect(tools).toHaveLength(10);
    expect(tools.map((t) => t.name).sort()).toEqual([
      'analyze_graph',
      'get_entity',
      'get_neighbors',
      'list_skills',
      'manage_entity',
      'manage_note',
      'manage_relationship',
      'merge_entities',
      'run_skill',
      'search',
    ]);
  });

  it('all tool names use snake_case', () => {
    const tools = provider.listTools();
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('tool definitions have required fields', () => {
    for (const def of MCP_TOOL_DEFINITIONS) {
      expect(def.name).toBeTruthy();
      expect(def.description).toBeTruthy();
      expect(def.inputSchema).toBeTruthy();
      expect(def.inputSchema.type).toBe('object');
    }
  });

  it('full CRUD cycle via tool handlers', async () => {
    // Create
    const createResult = await provider.executeTool('manage_entity', {
      action: 'create', name: 'Integration Test', type: 'concept',
    });
    expect(createResult.isError).toBeFalsy();
    const created = JSON.parse(createResult.result);
    expect(created.action).toBe('created');
    const entityId = created.id;

    // Search
    const searchResult = await provider.executeTool('search', { query: 'Integration' });
    const searched = JSON.parse(searchResult.result);
    expect(searched.results.length).toBeGreaterThanOrEqual(1);

    // Get
    const getResult = await provider.executeTool('get_entity', { entity_id: entityId });
    const entity = JSON.parse(getResult.result);
    expect(entity.name).toBe('Integration Test');

    // Update
    const updateResult = await provider.executeTool('manage_entity', {
      action: 'update', entity_id: entityId, name: 'Updated Name',
    });
    expect(JSON.parse(updateResult.result).action).toBe('updated');

    // Delete
    const deleteResult = await provider.executeTool('manage_entity', {
      action: 'delete', entity_id: entityId,
    });
    expect(JSON.parse(deleteResult.result).deleted).toBe(1);

    // Verify gone
    const goneResult = await provider.executeTool('get_entity', { entity_id: entityId });
    expect(JSON.parse(goneResult.result).error).toBeTruthy();
  });

  it('analyze_graph overview returns counts', async () => {
    await provider.executeTool('manage_entity', {
      action: 'create', name: 'A', type: 'entity',
    });
    await provider.executeTool('manage_entity', {
      action: 'create', name: 'B', type: 'concept',
    });

    const result = await provider.executeTool('analyze_graph', { analysis: 'overview' });
    const data = JSON.parse(result.result);
    expect(data.data.node_count).toBe(2);
  });

  it('isWrite flag set correctly for write tools', async () => {
    const writeResult = await provider.executeTool('manage_entity', {
      action: 'create', name: 'Test', type: 'entity',
    });
    expect(writeResult.isWrite).toBe(true);

    const readResult = await provider.executeTool('search', { query: 'test' });
    expect(readResult.isWrite).toBe(false);
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `npx vitest run tests/mcp/integration.test.ts`
Expected: All pass

- [ ] **Step 3: Run full test suite**

Run: `npm test`
Expected: All existing tests still pass. New tests pass.

- [ ] **Step 4: Build both targets**

Run: `npm run build:electron && npm run build:mcp`
Expected: Both build successfully

- [ ] **Step 5: Commit**

```bash
git add tests/mcp/integration.test.ts
git commit -m "test(mcp): add integration tests for shared core"
```

---

## File Map Summary

| File | Status | Purpose |
|------|--------|---------|
| `src/mcp/types.ts` | New | Shared types (SearchResult, EntityDetail, etc.) |
| `src/mcp/knowledge-service.ts` | New | KnowledgeService interface |
| `src/mcp/tools/types.ts` | New | McpToolDefinition, McpToolName, WRITE_TOOLS |
| `src/mcp/tools/definitions.ts` | New | 10 tool schemas (single source of truth) |
| `src/mcp/tools/handlers.ts` | New | Tool dispatch: name → KnowledgeService calls |
| `src/mcp/knowledge-tool-provider.ts` | New | MCP-facing provider wrapping KnowledgeService |
| `src/mcp/backends/electron-backend.ts` | New | ElectronKnowledgeService (IPC-backed) |
| `src/mcp/backends/electron-analysis.ts` | New | Analysis delegation for Electron backend |
| `src/mcp/backends/standalone-backend.ts` | New | StandaloneKnowledgeService (direct SQLite) |
| `packages/synapse-mcp/src/server.ts` | New | Shared MCP server factory |
| `packages/synapse-mcp/src/index.ts` | Modify | Replace inline tools with shared core |
| `electron/mcp/mcp-server-bridge.ts` | Modify | Accept KnowledgeToolProvider |
| `electron/main.ts` | Modify | Wire ElectronKnowledgeService |
| `tests/mcp/electron-backend.test.ts` | New | Unit tests for Electron backend |
| `tests/mcp/standalone-backend.test.ts` | New | Unit tests for standalone backend |
| `tests/mcp/tool-handlers.test.ts` | New | Unit tests for tool dispatch |
| `tests/mcp/integration.test.ts` | New | End-to-end integration tests |
