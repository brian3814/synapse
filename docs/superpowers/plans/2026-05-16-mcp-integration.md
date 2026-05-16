# MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add MCP client + server support via a unified ToolRegistry, enabling external agents (Claude Code, Cursor) to query/write to the knowledge graph, and the chat agent to use external MCP server tools.

**Architecture:** Unified ToolRegistry (singleton in main process) with provider pattern. BuiltinToolProvider wraps existing 14 chat tools. McpToolProvider wraps each external MCP server. McpServerBridge exposes the graph as an MCP server via HTTP (companion server) + stdio CLI. Tool execution moves from renderer to main process via new IPC channels.

**Tech Stack:** `@modelcontextprotocol/sdk` (MCP client + server), `better-sqlite3` (existing), `esbuild` (electron main build)

**Design Spec:** `docs/superpowers/specs/2026-05-15-mcp-integration-design.md`

---

## File Structure

### New files (create):

```
electron/mcp/
  types.ts                    — ToolProvider, ToolRegistry interfaces, ToolFilter, ToolResult
  tool-registry.ts            — ToolRegistry singleton implementation
  builtin-tool-provider.ts    — Wraps chat-tool-executor for main process
  main-process-context.ts     — Creates CommandContext using direct DataStore
  mcp-client-manager.ts       — Manages outbound MCP connections
  mcp-tool-provider.ts        — ToolProvider for a single MCP server connection
  mcp-server-bridge.ts        — Exposes graph tools as MCP server
  mcp-config.ts               — Config loading, merging, secret resolution
  mcp-ipc.ts                  — IPC handler registration for tools:* and mcp:* channels

packages/synapse-mcp/
  package.json                — Standalone npm package
  tsconfig.json               — TypeScript config
  src/index.ts                — CLI entry point (stdio transport)
  src/standalone-provider.ts  — Opens vault DB directly, no Electron
```

### Modified files:

```
electron/main.ts              — Add MCP init to startup sequence
electron/companion-server.ts  — Add /mcp route for Streamable HTTP
src/commands/types.ts         — Add EmbeddingProvider to CommandContext
src/commands/chat-tool-executor.ts — Remove @platform import, use ctx.embedding
src/commands/create-context.ts — Pass embedding through context
src/ui/hooks/chat-agent-loop.ts — Replace direct executeTool with IPC
src/platform/electron/index.ts — Export tools IPC bridge
src/platform/types.ts         — Add PlatformTools interface
package.json                  — Add @modelcontextprotocol/sdk dependency
```

---

## Task 1: Install MCP SDK + Types

**Files:**
- Modify: `package.json`
- Create: `electron/mcp/types.ts`

- [ ] **Step 1: Install the MCP SDK**

```bash
npm install @modelcontextprotocol/sdk
```

- [ ] **Step 2: Create the types file**

Create `electron/mcp/types.ts`:

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  category?: 'read' | 'write' | 'execute';
}

export interface ToolResult {
  result: string;
  collectedNodeIds?: string[];
  collectedEdgeIds?: string[];
  isError?: boolean;
}

export interface ToolFilter {
  disabledTools?: string[];
  providerIds?: string[];
  capabilities?: ('read' | 'write' | 'execute')[];
}

export interface ToolProvider {
  readonly id: string;
  readonly namespace: string | null;
  listTools(): ToolDefinition[];
  executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult>;
  dispose(): void;
}

export interface ToolRegistryEvents {
  onToolsChanged(cb: () => void): () => void;
}

export interface IToolRegistry extends ToolRegistryEvents {
  registerProvider(provider: ToolProvider): void;
  removeProvider(id: string): void;
  getAvailableTools(filter?: ToolFilter): ToolDefinition[];
  getProviders(): ToolProvider[];
  executeTool(namespacedName: string, input: Record<string, unknown>): Promise<ToolResult>;
  dispose(): void;
}

export interface McpServerConfig {
  transport: 'stdio' | 'http';
  enabled?: boolean;
  disabledTools?: string[];
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export interface McpClientConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export interface AccessProfile {
  name: string;
  capabilities: ('read' | 'write')[];
  allowedTools?: string[];
  blockedTools?: string[];
}

export interface McpServerExposedConfig {
  enabled: boolean;
  profiles: Record<string, AccessProfile>;
  httpTransport: {
    port: number;
    path: string;
  };
}

export const NAMESPACE_SEPARATOR = '__';
```

- [ ] **Step 3: Verify build**

```bash
npm run build:electron-main
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mcp): install SDK and define tool registry types"
```

---

## Task 2: Refactor chat-tool-executor to remove @platform import

The executor currently imports `embedding` from `@platform` (line 8). This prevents main-process usage. Move embedding into `CommandContext`.

**Files:**
- Modify: `src/commands/types.ts`
- Modify: `src/commands/chat-tool-executor.ts`
- Modify: `src/commands/create-context.ts`

- [ ] **Step 1: Add embedding to CommandContext**

In `src/commands/types.ts`, add an `EmbeddingSearch` type and include it in `CommandContext`:

```typescript
import type { DataStore } from '../db/data-store';
import type { PlatformStorage, PlatformNotes, PlatformFiles, PlatformLLM, PlatformBrowser } from '../platform/types';
import type { GraphNode, GraphEdge, DbNode, DbEdge, NodeType } from '../shared/types';

export interface EmbeddingSearchResult {
  nodeId: string;
  distance: number;
}

export interface EmbeddingSearch {
  search(query: string, limit?: number, excludeNodeId?: string): Promise<EmbeddingSearchResult[]>;
}

export interface CommandContext {
  db: DataStore;
  storage: PlatformStorage;
  notes: PlatformNotes;
  files: PlatformFiles;
  llm: PlatformLLM;
  browser: PlatformBrowser;
  embedding?: EmbeddingSearch;
  getGraphSnapshot(): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }>;
}
```

- [ ] **Step 2: Update chat-tool-executor.ts**

Remove the `@platform` import and use `ctx.embedding`:

Replace line 8:
```typescript
import { embedding } from '@platform';
```

Remove it entirely. Then in the `semantic_search` case (find it in the switch), replace `embedding.search(...)` with `ctx.embedding?.search(...)`. If `ctx.embedding` is undefined, return an error result saying embeddings are not configured.

- [ ] **Step 3: Update create-context.ts to pass embedding**

In `src/commands/create-context.ts`, import `embedding` from `@platform` and pass it into the context:

```typescript
import * as dbClient from '../db/client/db-client';
import { storage, notes, files, llm, browser, embedding } from '@platform';
import { useGraphStore } from '../graph/store/graph-store';
import type { CommandContext } from './types';
import type { DataStore } from '../db/data-store';

// ... dbClientAsDataStore() unchanged ...

export function createUICommandContext(): CommandContext {
  return {
    db: dbClientAsDataStore(),
    storage,
    notes,
    files,
    llm,
    browser,
    embedding: embedding as any,
    getGraphSnapshot: () => {
      const state = useGraphStore.getState();
      return Promise.resolve({ nodes: state.nodes, edges: state.edges });
    },
  };
}
```

- [ ] **Step 4: Verify both builds**

```bash
npm run build:electron-main && npm run build:electron-renderer
```

Expected: Both succeed. The renderer still works as before (embedding passed through context now), and the main process no longer has a transitive @platform dependency from the executor.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor: move embedding into CommandContext, remove @platform from executor"
```

---

## Task 3: ToolRegistry implementation

**Files:**
- Create: `electron/mcp/tool-registry.ts`

- [ ] **Step 1: Implement the registry**

Create `electron/mcp/tool-registry.ts`:

```typescript
import { NAMESPACE_SEPARATOR } from './types';
import type { IToolRegistry, ToolProvider, ToolDefinition, ToolResult, ToolFilter } from './types';

export class ToolRegistry implements IToolRegistry {
  private providers = new Map<string, ToolProvider>();
  private listeners = new Set<() => void>();

  registerProvider(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      this.providers.get(provider.id)!.dispose();
    }
    this.providers.set(provider.id, provider);
    this.notifyChanged();
  }

  removeProvider(id: string): void {
    const provider = this.providers.get(id);
    if (provider) {
      provider.dispose();
      this.providers.delete(id);
      this.notifyChanged();
    }
  }

  getProviders(): ToolProvider[] {
    return [...this.providers.values()];
  }

  getAvailableTools(filter?: ToolFilter): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const provider of this.providers.values()) {
      if (filter?.providerIds && !filter.providerIds.includes(provider.id)) continue;

      for (const tool of provider.listTools()) {
        const namespacedName = provider.namespace
          ? `${provider.namespace}${NAMESPACE_SEPARATOR}${tool.name}`
          : tool.name;

        if (filter?.disabledTools?.includes(namespacedName)) continue;
        if (filter?.capabilities && tool.category && !filter.capabilities.includes(tool.category)) continue;

        tools.push({
          ...tool,
          name: namespacedName,
        });
      }
    }

    return tools;
  }

  async executeTool(namespacedName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const { providerId, toolName } = this.parseToolName(namespacedName);
    const provider = this.providers.get(providerId);

    if (!provider) {
      return { result: JSON.stringify({ error: `No provider found for tool: ${namespacedName}` }), isError: true };
    }

    return provider.executeTool(toolName, input);
  }

  onToolsChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.listeners.clear();
  }

  private parseToolName(namespacedName: string): { providerId: string; toolName: string } {
    const sepIdx = namespacedName.indexOf(NAMESPACE_SEPARATOR);
    if (sepIdx === -1) {
      return { providerId: 'builtin', toolName: namespacedName };
    }
    const namespace = namespacedName.slice(0, sepIdx);
    const toolName = namespacedName.slice(sepIdx + NAMESPACE_SEPARATOR.length);
    return { providerId: `mcp:${namespace}`, toolName };
  }

  private notifyChanged(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch {}
    }
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main
```

Expected: Succeeds.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mcp): implement ToolRegistry with provider dispatch"
```

---

## Task 4: BuiltinToolProvider + MainProcessContext

**Files:**
- Create: `electron/mcp/main-process-context.ts`
- Create: `electron/mcp/builtin-tool-provider.ts`

- [ ] **Step 1: Create MainProcessContext factory**

Create `electron/mcp/main-process-context.ts`:

```typescript
import type { CommandContext, EmbeddingSearch } from '../../src/commands/types';
import type { DataStore } from '../../src/db/data-store';
import type { PlatformStorage, PlatformNotes, PlatformFiles, PlatformLLM, PlatformBrowser } from '../../src/platform/types';

interface MainProcessDeps {
  dataStore: DataStore;
  storage: PlatformStorage;
  readNote: (nodeId: string) => Promise<string | null>;
  writeNote: (nodeId: string, content: string) => Promise<void>;
  embedding?: EmbeddingSearch;
}

export function createMainProcessContext(deps: MainProcessDeps): CommandContext {
  const notesAdapter: PlatformNotes = {
    read: deps.readNote,
    write: deps.writeNote,
    delete: async () => {},
    list: async () => [],
  };

  const noopFiles: PlatformFiles = {
    readFile: async () => null,
    writeFile: async () => {},
    deleteFile: async () => {},
    listFiles: async () => [],
  };

  const noopLLM: PlatformLLM = {
    streamExtraction: async () => ({ text: '', inputTokens: 0, outputTokens: 0 }),
    runAgent: async () => {},
    streamChat: async () => ({ textContent: '', toolCalls: [], stopReason: 'end_turn', inputTokens: 0, outputTokens: 0 }),
  } as any;

  const noopBrowser: PlatformBrowser = {
    getCurrentTab: async () => null,
    executeContentScript: async () => null,
  } as any;

  return {
    db: deps.dataStore,
    storage: deps.storage,
    notes: notesAdapter,
    files: noopFiles,
    llm: noopLLM,
    browser: noopBrowser,
    embedding: deps.embedding,
    getGraphSnapshot: async () => {
      const nodes = await deps.dataStore.nodes.getAll();
      const edges = await deps.dataStore.edges.getAll();
      return { nodes: nodes as any, edges: edges as any };
    },
  };
}
```

- [ ] **Step 2: Create BuiltinToolProvider**

Create `electron/mcp/builtin-tool-provider.ts`:

```typescript
import type { ToolProvider, ToolDefinition, ToolResult } from './types';
import type { CommandContext } from '../../src/commands/types';
import { CHAT_AGENT_TOOLS } from '../../src/shared/chat-agent-tools';
import { executeTool } from '../../src/commands/chat-tool-executor';

const READ_TOOLS = new Set([
  'search_knowledge', 'search_nodes', 'get_node_details',
  'get_neighbors', 'get_edges_for_node', 'search_sources',
  'get_source_content', 'semantic_search',
]);

const WRITE_TOOLS = new Set([
  'create_node', 'update_node', 'create_edge',
  'delete_node', 'merge_nodes',
]);

export class BuiltinToolProvider implements ToolProvider {
  readonly id = 'builtin';
  readonly namespace = null;

  constructor(private ctx: CommandContext) {}

  listTools(): ToolDefinition[] {
    return CHAT_AGENT_TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      category: READ_TOOLS.has(t.name) ? 'read' as const
        : WRITE_TOOLS.has(t.name) ? 'write' as const
        : 'execute' as const,
    }));
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const result = await executeTool(this.ctx, name, input);
      return {
        result: result.result,
        collectedNodeIds: result.collectedNodeIds,
        collectedEdgeIds: result.collectedEdgeIds,
      };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  dispose(): void {}
}
```

- [ ] **Step 3: Verify build**

```bash
npm run build:electron-main
```

Expected: Succeeds. The main process build (esbuild) bundles the shared src/commands/ and src/shared/ modules. The key issue to watch: if `chat-tool-executor.ts` still has any `@platform` import, esbuild will fail because it can't resolve the alias. Task 2 must have removed it.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(mcp): add BuiltinToolProvider with main-process context"
```

---

## Task 5: IPC channels for ToolRegistry

**Files:**
- Create: `electron/mcp/mcp-ipc.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Create IPC handler registration**

Create `electron/mcp/mcp-ipc.ts`:

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import type { IToolRegistry } from './types';
import type { ToolFilter } from './types';

export function registerToolIpcHandlers(getRegistry: () => IToolRegistry | null): void {
  ipcMain.handle('tools:list', async (_event, filter?: ToolFilter) => {
    const registry = getRegistry();
    if (!registry) return [];
    return registry.getAvailableTools(filter);
  });

  ipcMain.handle('tools:execute', async (_event, payload: { name: string; input: Record<string, unknown> }) => {
    const registry = getRegistry();
    if (!registry) {
      return { result: JSON.stringify({ error: 'Tool registry not initialized' }), isError: true };
    }
    return registry.executeTool(payload.name, payload.input);
  });
}

export function broadcastToolsChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('tools:on-changed');
  }
}
```

- [ ] **Step 2: Register in main.ts**

In `electron/main.ts`, import and call registration after the vault setup area (near line 376 where `startCompanionServer` is called):

Add import at top of file:
```typescript
import { registerToolIpcHandlers, broadcastToolsChanged } from './mcp/mcp-ipc';
import { ToolRegistry } from './mcp/tool-registry';
import { BuiltinToolProvider } from './mcp/builtin-tool-provider';
import { createMainProcessContext } from './mcp/main-process-context';
```

After `startCompanionServer(storage);` (line 376), add:

```typescript
// ── MCP / Tool Registry ──────────────────────────────────────────
let toolRegistry: ToolRegistry | null = null;
registerToolIpcHandlers(() => toolRegistry);
```

Then inside `registerVaultHandlers()` function (after reconciliation completes), initialize the registry:

```typescript
// Initialize tool registry with BuiltinToolProvider
const mainCtx = createMainProcessContext({
  dataStore,
  storage,
  readNote: async (nodeId) => readNote(nodeId),
  writeNote: async (nodeId, content) => writeNote(nodeId, content),
  embedding: embeddingService ? {
    search: (query, limit, excludeNodeId) =>
      embeddingService!.search(query, limit ?? 5, excludeNodeId),
  } : undefined,
});
toolRegistry = new ToolRegistry();
toolRegistry.registerProvider(new BuiltinToolProvider(mainCtx));
toolRegistry.onToolsChanged(() => broadcastToolsChanged());
```

Note: `dataStore` is already accessible from `db-backend.ts` imports. `readNote`/`writeNote` are from `notes-backend.ts`. Adjust variable references to match what's in scope.

- [ ] **Step 3: Verify build**

```bash
npm run build:electron-main
```

Expected: Succeeds.

- [ ] **Step 4: Manual test**

```bash
npm run build:electron && npx electron .
```

Open DevTools in the renderer, run in console:
```javascript
window.electronIPC.invoke('tools:list', {}).then(console.log)
```

Expected: Returns array of 14+ tool definitions (the existing chat tools).

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mcp): register tool registry IPC handlers in main process"
```

---

## Task 6: Update chat-agent-loop to use IPC for tool execution

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`
- Modify: `src/platform/electron/index.ts` (if needed for IPC typing)

- [ ] **Step 1: Replace direct executeTool with IPC call**

In `src/ui/hooks/chat-agent-loop.ts`:

Replace the imports at the top (lines 1-6). Remove `executeTool` import and `createUICommandContext`:

```typescript
import { CHAT_AGENT_TOOLS, toAnthropicChatTools } from '../../shared/chat-agent-tools';
import { llm, platformId } from '@platform';
import type { ChatAgentTurn } from '../../shared/types';
import type { AnthropicMessage, AnthropicContentBlock } from '../../offscreen/llm-executor';
```

Remove `const ctx = createUICommandContext();` (line 99).

Replace the tool execution block (lines 162-170):

```typescript
let resultStr: string;
let isError = false;
try {
  const toolResult = await window.electronIPC.invoke('tools:execute', {
    name: tc.name,
    input: tc.input,
  });
  resultStr = toolResult.result;
  isError = toolResult.isError ?? false;
  if (toolResult.collectedNodeIds) for (const id of toolResult.collectedNodeIds) collectedNodeIds.add(id);
  if (toolResult.collectedEdgeIds) for (const id of toolResult.collectedEdgeIds) collectedEdgeIds.add(id);
} catch (e: any) {
  resultStr = JSON.stringify({ error: e.message });
  isError = true;
}
```

Also replace `getToolDefs` to fetch from registry via IPC. However, since `tools:list` is async and `getToolDefs` is called inside the loop (line 111), we should fetch tools once before the loop starts:

Before the `for` loop (before line 101), add:
```typescript
const toolDefs = await window.electronIPC.invoke('tools:list', {
  disabledTools: disabledTools ?? [],
});
const tools = toolDefs.map((t: any) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters,
}));
```

Then in `sendChatLLMRequest` call (line 111), replace `tools: getToolDefs(disabledTools)` with `tools`.

Remove the old `getToolDefs` function (lines 39-53) and the `SEMANTIC_SEARCH_TOOL` constant (lines 26-37) — these are now handled by the registry.

- [ ] **Step 2: Handle Chrome platform fallback**

For Chrome (deprecated but still builds), `window.electronIPC` doesn't exist. Guard the IPC calls:

```typescript
const useRegistryIPC = platformId === 'electron' && typeof window !== 'undefined' && 'electronIPC' in window;
```

If `!useRegistryIPC`, fall back to the old direct execution path (import `createUICommandContext` and `executeTool` conditionally). For simplicity, since Chrome is deprecated, you can just keep the existing code path behind a platform check.

- [ ] **Step 3: Verify both builds**

```bash
npm run build:electron && npm run build
```

Expected: Both Electron and Chrome builds succeed.

- [ ] **Step 4: Manual test**

```bash
npx electron .
```

Open the app, send a chat message that triggers a tool call (e.g., "What do I know about X?"). Verify:
- Tool calls work (search_knowledge returns results)
- Results appear in chat
- No console errors

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(mcp): route chat agent tool execution through registry IPC"
```

---

## Task 7: MCP Configuration system

**Files:**
- Create: `electron/mcp/mcp-config.ts`

- [ ] **Step 1: Implement config loading and merging**

Create `electron/mcp/mcp-config.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import type { McpClientConfig, McpServerConfig, McpServerExposedConfig } from './types';

interface ConfigSources {
  globalConfigPath: string;
  vaultConfigPath?: string;
  secretsPath?: string;
}

export function loadMcpClientConfig(sources: ConfigSources): McpClientConfig {
  const globalConfig = readJsonFile<McpClientConfig>(sources.globalConfigPath);
  const vaultConfig = sources.vaultConfigPath
    ? readJsonFile<McpClientConfig>(sources.vaultConfigPath)
    : null;

  const merged: McpClientConfig = { mcpServers: {} };

  // Start with global servers
  if (globalConfig?.mcpServers) {
    for (const [name, config] of Object.entries(globalConfig.mcpServers)) {
      merged.mcpServers[name] = { ...config };
    }
  }

  // Overlay vault servers (deep merge per-server)
  if (vaultConfig?.mcpServers) {
    for (const [name, config] of Object.entries(vaultConfig.mcpServers)) {
      if (name in merged.mcpServers) {
        merged.mcpServers[name] = { ...merged.mcpServers[name], ...config };
      } else {
        merged.mcpServers[name] = { ...config };
      }
    }
  }

  return merged;
}

export function loadMcpServerConfig(vaultPath: string): McpServerExposedConfig {
  const configPath = path.join(vaultPath, '.kg', 'mcp-server.json');
  const config = readJsonFile<McpServerExposedConfig>(configPath);
  return config ?? {
    enabled: false,
    profiles: {
      default: { name: 'default', capabilities: ['read'], blockedTools: [] },
    },
    httpTransport: { port: 19876, path: '/mcp' },
  };
}

export function resolveSecrets(
  config: McpServerConfig,
  secretsMap: Record<string, string>
): McpServerConfig {
  const resolved = { ...config };

  if (resolved.env) {
    resolved.env = resolveRecord(resolved.env, secretsMap);
  }
  if (resolved.headers) {
    resolved.headers = resolveRecord(resolved.headers, secretsMap);
  }

  return resolved;
}

export function loadSecrets(globalSecretsPath: string, vaultSecretsPath?: string): Record<string, string> {
  const global = readJsonFile<Record<string, string>>(globalSecretsPath) ?? {};
  const vault = vaultSecretsPath ? readJsonFile<Record<string, string>>(vaultSecretsPath) ?? {} : {};
  return { ...global, ...vault };
}

function resolveRecord(record: Record<string, string>, secrets: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    const match = value.match(/^\$\{secret:(.+)\}$/);
    if (match && secrets[match[1]]) {
      result[key] = secrets[match[1]];
    } else {
      result[key] = value;
    }
  }
  return result;
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mcp): add config loading with two-layer merge and secret resolution"
```

---

## Task 8: McpToolProvider

**Files:**
- Create: `electron/mcp/mcp-tool-provider.ts`

- [ ] **Step 1: Implement McpToolProvider**

Create `electron/mcp/mcp-tool-provider.ts`:

```typescript
import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from './types';

export class McpToolProvider implements ToolProvider {
  readonly id: string;
  readonly namespace: string;
  private tools: ToolDefinition[] = [];
  private disabledTools: Set<string>;

  constructor(
    private serverName: string,
    private client: Client,
    disabledTools?: string[],
  ) {
    this.id = `mcp:${serverName}`;
    this.namespace = serverName;
    this.disabledTools = new Set(disabledTools ?? []);
  }

  async discoverTools(): Promise<void> {
    const response = await this.client.listTools();
    this.tools = response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema as Record<string, unknown>,
    }));
  }

  listTools(): ToolDefinition[] {
    return this.tools.filter((t) => !this.disabledTools.has(t.name));
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const response = await this.client.callTool({ name, arguments: input });
      const textContent = response.content
        .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
        .map((c) => c.text)
        .join('\n');

      return {
        result: textContent || JSON.stringify(response.content),
        isError: response.isError ?? false,
      };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  dispose(): void {
    // Client cleanup handled by McpClientManager
  }
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build:electron-main
```

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(mcp): add McpToolProvider wrapping MCP SDK client"
```

---

## Task 9: McpClientManager

**Files:**
- Create: `electron/mcp/mcp-client-manager.ts`

- [ ] **Step 1: Implement McpClientManager**

Create `electron/mcp/mcp-client-manager.ts`:

```typescript
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { McpToolProvider } from './mcp-tool-provider';
import { resolveSecrets, loadSecrets } from './mcp-config';
import type { IToolRegistry, McpClientConfig, McpServerConfig } from './types';

interface McpConnection {
  serverName: string;
  client: Client;
  transport: StdioClientTransport;
  provider: McpToolProvider;
  state: 'connecting' | 'connected' | 'disconnected' | 'error';
  error?: string;
}

interface McpClientManagerOptions {
  registry: IToolRegistry;
  globalSecretsPath: string;
  vaultSecretsPath?: string;
  onStatusChanged?: (serverName: string, state: McpConnection['state'], error?: string) => void;
}

export class McpClientManager {
  private connections = new Map<string, McpConnection>();
  private registry: IToolRegistry;
  private secrets: Record<string, string>;
  private onStatusChanged?: (serverName: string, state: McpConnection['state'], error?: string) => void;

  constructor(options: McpClientManagerOptions) {
    this.registry = options.registry;
    this.secrets = loadSecrets(options.globalSecretsPath, options.vaultSecretsPath);
    this.onStatusChanged = options.onStatusChanged;
  }

  async connectAll(config: McpClientConfig): Promise<void> {
    const connectPromises: Promise<void>[] = [];

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      if (serverConfig.enabled === false) continue;
      connectPromises.push(this.connectServer(name, serverConfig));
    }

    await Promise.allSettled(connectPromises);
  }

  async connectServer(name: string, config: McpServerConfig): Promise<void> {
    // Disconnect existing connection if any
    await this.disconnectServer(name);

    const resolved = resolveSecrets(config, this.secrets);

    if (resolved.transport === 'stdio') {
      await this.connectStdio(name, resolved);
    } else if (resolved.transport === 'http') {
      // HTTP transport support — import dynamically to avoid bundling issues
      console.warn(`[MCP] HTTP transport for ${name} not yet implemented`);
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;

    this.registry.removeProvider(conn.provider.id);
    try {
      await conn.client.close();
    } catch {}
    try {
      await conn.transport.close();
    } catch {}
    this.connections.delete(name);
  }

  getStatus(): Array<{ name: string; state: string; error?: string; toolCount: number }> {
    return [...this.connections.entries()].map(([name, conn]) => ({
      name,
      state: conn.state,
      error: conn.error,
      toolCount: conn.provider.listTools().length,
    }));
  }

  async dispose(): Promise<void> {
    for (const name of [...this.connections.keys()]) {
      await this.disconnectServer(name);
    }
  }

  private async connectStdio(name: string, config: McpServerConfig): Promise<void> {
    if (!config.command) {
      console.error(`[MCP] No command specified for server: ${name}`);
      return;
    }

    const conn: McpConnection = {
      serverName: name,
      state: 'connecting',
    } as any;
    this.connections.set(name, conn);
    this.onStatusChanged?.(name, 'connecting');

    try {
      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args ?? [],
        env: { ...process.env, ...(config.env ?? {}) } as Record<string, string>,
      });

      const client = new Client(
        { name: 'synapse', version: '1.0.0' },
        { capabilities: { tools: {} } },
      );

      await client.connect(transport);

      const provider = new McpToolProvider(name, client, config.disabledTools);
      await provider.discoverTools();

      conn.client = client;
      conn.transport = transport;
      conn.provider = provider;
      conn.state = 'connected';

      this.registry.registerProvider(provider);
      this.onStatusChanged?.(name, 'connected');

      console.log(`[MCP] Connected to ${name}: ${provider.listTools().length} tools discovered`);
    } catch (e: any) {
      conn.state = 'error';
      conn.error = e.message;
      this.onStatusChanged?.(name, 'error', e.message);
      console.error(`[MCP] Failed to connect to ${name}:`, e.message);
    }
  }
}
```

- [ ] **Step 2: Add MCP client IPC handlers**

In `electron/mcp/mcp-ipc.ts`, add handlers for `mcp:*` channels. Append to the file:

```typescript
import type { McpClientManager } from './mcp-client-manager';

export function registerMcpClientIpcHandlers(getManager: () => McpClientManager | null): void {
  ipcMain.handle('mcp:list-servers', async () => {
    const manager = getManager();
    if (!manager) return [];
    return manager.getStatus();
  });

  ipcMain.handle('mcp:connect-server', async (_event, name: string) => {
    const manager = getManager();
    if (!manager) return { error: 'MCP not initialized' };
    // Re-read config and connect — simplified for now
    return { success: true };
  });

  ipcMain.handle('mcp:disconnect-server', async (_event, name: string) => {
    const manager = getManager();
    if (!manager) return;
    await manager.disconnectServer(name);
  });
}
```

- [ ] **Step 3: Wire McpClientManager into main.ts**

In `electron/main.ts`, inside `registerVaultHandlers()` after the toolRegistry initialization, add:

```typescript
import { McpClientManager } from './mcp/mcp-client-manager';
import { loadMcpClientConfig } from './mcp/mcp-config';
import { registerMcpClientIpcHandlers } from './mcp/mcp-ipc';

// ... inside registerVaultHandlers(), after toolRegistry init:
let mcpClientManager: McpClientManager | null = null;
registerMcpClientIpcHandlers(() => mcpClientManager);

const globalConfigPath = path.join(app.getPath('userData'), 'mcp-config.json');
const vaultConfigPath = path.join(ctx.path, '.kg', 'mcp.json');
const globalSecretsPath = path.join(app.getPath('userData'), 'mcp-secrets.json');
const vaultSecretsPath = path.join(ctx.path, '.kg', 'secrets.json');

const mcpConfig = loadMcpClientConfig({ globalConfigPath, vaultConfigPath });

if (Object.keys(mcpConfig.mcpServers).length > 0) {
  mcpClientManager = new McpClientManager({
    registry: toolRegistry,
    globalSecretsPath,
    vaultSecretsPath,
    onStatusChanged: (name, state, error) => {
      for (const win of BrowserWindow.getAllWindows()) {
        win.webContents.send('mcp:server-status-changed', { name, state, error });
      }
    },
  });
  mcpClientManager.connectAll(mcpConfig).catch((e) =>
    console.error('[MCP] Failed to connect servers:', e)
  );
}
```

- [ ] **Step 4: Verify build**

```bash
npm run build:electron-main
```

- [ ] **Step 5: Manual test with a real MCP server**

Create a test config file at `~/Library/Application Support/kg-desktop/mcp-config.json`:

```json
{
  "mcpServers": {
    "filesystem": {
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    }
  }
}
```

Run the app, then in console:
```javascript
window.electronIPC.invoke('mcp:list-servers').then(console.log)
window.electronIPC.invoke('tools:list', {}).then(t => console.log(t.map(x => x.name)))
```

Expected: `mcp:list-servers` returns `[{ name: 'filesystem', state: 'connected', toolCount: N }]`. `tools:list` returns built-in tools PLUS `filesystem__read_file`, `filesystem__write_file`, etc.

- [ ] **Step 6: Test MCP tool execution via chat**

Send a chat message like "List files in /tmp using the filesystem tool" and verify the agent calls `filesystem__list_directory` successfully.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(mcp): implement McpClientManager with stdio transport"
```

---

## Task 10: McpServerBridge (expose graph via HTTP)

**Files:**
- Create: `electron/mcp/mcp-server-bridge.ts`
- Modify: `electron/companion-server.ts`

- [ ] **Step 1: Implement McpServerBridge**

Create `electron/mcp/mcp-server-bridge.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IToolRegistry, McpServerExposedConfig, ToolFilter } from './types';

export class McpServerBridge {
  private server: McpServer;
  private transport: StreamableHTTPServerTransport | null = null;
  private config: McpServerExposedConfig;
  private registry: IToolRegistry;

  constructor(registry: IToolRegistry, config: McpServerExposedConfig) {
    this.registry = registry;
    this.config = config;
    this.server = new McpServer({ name: 'synapse', version: '1.0.0' });
    this.registerTools();
  }

  private registerTools(): void {
    const defaultProfile = this.config.profiles['default'] ?? {
      name: 'default',
      capabilities: ['read'],
      blockedTools: [],
    };

    const filter: ToolFilter = {
      providerIds: ['builtin'],
      capabilities: defaultProfile.capabilities,
      disabledTools: [
        ...(defaultProfile.blockedTools ?? []),
        'manage_memory',
        'index_notes_folder',
      ],
    };

    const tools = this.registry.getAvailableTools(filter);

    for (const tool of tools) {
      this.server.tool(
        tool.name,
        tool.description,
        tool.parameters as any,
        async (args: Record<string, unknown>) => {
          const result = await this.registry.executeTool(tool.name, args);
          return {
            content: [{ type: 'text' as const, text: result.result }],
            isError: result.isError,
          };
        },
      );
    }
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.transport) {
      this.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await this.server.connect(this.transport);
    }
    await this.transport.handleRequest(req, res);
  }

  async dispose(): Promise<void> {
    await this.server.close();
  }
}
```

- [ ] **Step 2: Add /mcp route to companion server**

In `electron/companion-server.ts`, modify the server creation to accept an optional MCP handler:

```typescript
import { createServer, IncomingMessage, ServerResponse } from 'http';
import { BrowserWindow } from 'electron';
import { StorageBackend } from './storage-backend';

const PORT = 19876;

// ... existing helpers (readBody, cors, json) unchanged ...

interface CompanionServerOptions {
  storage?: StorageBackend;
  mcpHandler?: (req: IncomingMessage, res: ServerResponse) => Promise<void>;
}

export function startCompanionServer(options: CompanionServerOptions = {}): void {
  const { storage: storageBackend, mcpHandler } = options;

  const server = createServer(async (req, res) => {
    // ... existing routes unchanged ...

    // MCP Streamable HTTP endpoint
    if (req.url === '/mcp' && mcpHandler) {
      try {
        await mcpHandler(req, res);
      } catch (e: any) {
        json(res, 500, { error: e.message });
      }
      return;
    }

    json(res, 404, { error: 'Not found' });
  });

  // ... rest unchanged ...
}
```

Update the call in `main.ts` from `startCompanionServer(storage)` to pass the MCP handler once the bridge is created.

- [ ] **Step 3: Wire MCP server into main.ts**

In the `registerVaultHandlers()` function, after MCP client init:

```typescript
import { McpServerBridge } from './mcp/mcp-server-bridge';
import { loadMcpServerConfig } from './mcp/mcp-config';

const serverConfig = loadMcpServerConfig(ctx.path);
let mcpServerBridge: McpServerBridge | null = null;

if (serverConfig.enabled) {
  mcpServerBridge = new McpServerBridge(toolRegistry, serverConfig);
  // Update companion server to include MCP handler
  // Note: companion server already started — need to handle late registration
  // or start it after vault opens
}
```

Note: The companion server starts before vault opens (line 376). The MCP server needs the vault (ToolRegistry). Solution: pass a late-binding handler function to the companion server that gets set once vault opens.

- [ ] **Step 4: Verify build**

```bash
npm run build:electron-main
```

- [ ] **Step 5: Manual test with MCP Inspector**

```bash
npx @modelcontextprotocol/inspector http://127.0.0.1:19876/mcp
```

Expected: MCP Inspector connects, shows list of available tools (the 12 exposed built-in tools), and you can call them interactively.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(mcp): expose graph tools via MCP server on companion HTTP endpoint"
```

---

## Task 11: synapse-mcp CLI package (stdio transport)

**Files:**
- Create: `packages/synapse-mcp/package.json`
- Create: `packages/synapse-mcp/tsconfig.json`
- Create: `packages/synapse-mcp/src/index.ts`
- Create: `packages/synapse-mcp/src/standalone-provider.ts`

- [ ] **Step 1: Create package scaffold**

Create `packages/synapse-mcp/package.json`:

```json
{
  "name": "synapse-mcp",
  "version": "0.1.0",
  "description": "MCP server for Synapse knowledge graph",
  "bin": {
    "synapse-mcp": "./dist/index.js"
  },
  "scripts": {
    "build": "esbuild src/index.ts --bundle --platform=node --outdir=dist --format=esm --banner:js=\"#!/usr/bin/env node\" --packages=external",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "better-sqlite3": "^12.9.0"
  },
  "devDependencies": {
    "esbuild": "^0.25.0",
    "tsx": "^4.0.0",
    "@types/better-sqlite3": "^7.6.8"
  }
}
```

Create `packages/synapse-mcp/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 2: Create standalone provider**

Create `packages/synapse-mcp/src/standalone-provider.ts`:

```typescript
import Database from 'better-sqlite3';
import * as path from 'path';

export interface StandaloneToolResult {
  result: string;
  isError?: boolean;
}

export class StandaloneGraphProvider {
  private db: Database.Database;

  constructor(vaultPath: string, readonly: boolean = true) {
    const dbPath = path.join(vaultPath, '.kg', 'graph.db');
    this.db = new Database(dbPath, { readonly });
  }

  searchNodes(query: string, limit = 10): StandaloneToolResult {
    try {
      const rows = this.db.prepare(
        `SELECT id, name, type, label FROM nodes WHERE name LIKE ? LIMIT ?`
      ).all(`%${query}%`, limit);
      return { result: JSON.stringify(rows) };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  getNodeDetails(id: string): StandaloneToolResult {
    try {
      const node = this.db.prepare(`SELECT * FROM nodes WHERE id = ?`).get(id);
      if (!node) return { result: JSON.stringify({ error: 'Node not found' }), isError: true };

      const edges = this.db.prepare(
        `SELECT * FROM edges WHERE source_id = ? OR target_id = ?`
      ).all(id, id);

      return { result: JSON.stringify({ node, edges }) };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  getNeighbors(nodeId: string, depth = 1): StandaloneToolResult {
    try {
      const visited = new Set<string>([nodeId]);
      let frontier = [nodeId];

      for (let d = 0; d < depth; d++) {
        const nextFrontier: string[] = [];
        for (const id of frontier) {
          const edges = this.db.prepare(
            `SELECT source_id, target_id FROM edges WHERE source_id = ? OR target_id = ?`
          ).all(id, id) as Array<{ source_id: string; target_id: string }>;

          for (const edge of edges) {
            const neighborId = edge.source_id === id ? edge.target_id : edge.source_id;
            if (!visited.has(neighborId)) {
              visited.add(neighborId);
              nextFrontier.push(neighborId);
            }
          }
        }
        frontier = nextFrontier;
      }

      visited.delete(nodeId);
      const placeholders = [...visited].map(() => '?').join(',');
      const neighbors = placeholders
        ? this.db.prepare(`SELECT id, name, type, label FROM nodes WHERE id IN (${placeholders})`).all(...visited)
        : [];

      return { result: JSON.stringify(neighbors) };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 3: Create CLI entry point**

Note: The CLI ships with 3 core tools as MVP (search_nodes, get_node_details, get_neighbors). The full 12-tool set (matching the HTTP server) will be added once the standalone provider is expanded to support write operations and RAG. This keeps the initial package small and testable.

Create `packages/synapse-mcp/src/index.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StandaloneGraphProvider } from './standalone-provider.js';

const args = process.argv.slice(2);
const vaultIdx = args.indexOf('--vault');
const vaultPath = vaultIdx !== -1 ? args[vaultIdx + 1] : null;
const allowWrite = args.includes('--allow-write');

if (!vaultPath) {
  console.error('Usage: synapse-mcp --vault <path-to-vault> [--allow-write]');
  process.exit(1);
}

const provider = new StandaloneGraphProvider(vaultPath, !allowWrite);
const server = new McpServer({ name: 'synapse', version: '1.0.0' });

// Register tools
server.tool(
  'search_nodes',
  'Full-text search for nodes in the knowledge graph by name',
  { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
  async ({ query, limit }) => {
    const result = provider.searchNodes(query as string, limit as number);
    return { content: [{ type: 'text', text: result.result }], isError: result.isError };
  },
);

server.tool(
  'get_node_details',
  'Get full details of a node by ID including connected edges',
  { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  async ({ id }) => {
    const result = provider.getNodeDetails(id as string);
    return { content: [{ type: 'text', text: result.result }], isError: result.isError };
  },
);

server.tool(
  'get_neighbors',
  'Get neighboring nodes within N hops of a given node',
  { type: 'object', properties: { node_id: { type: 'string' }, depth: { type: 'number' } }, required: ['node_id'] },
  async ({ node_id, depth }) => {
    const result = provider.getNeighbors(node_id as string, depth as number ?? 1);
    return { content: [{ type: 'text', text: result.result }], isError: result.isError };
  },
);

// Start stdio transport
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error('Fatal:', e);
  process.exit(1);
});

process.on('SIGINT', () => {
  provider.close();
  process.exit(0);
});
```

- [ ] **Step 4: Install dependencies and build**

```bash
cd packages/synapse-mcp && npm install && npm run build
```

Expected: Build produces `packages/synapse-mcp/dist/index.js`.

- [ ] **Step 5: Test with MCP Inspector**

```bash
npx @modelcontextprotocol/inspector -- node packages/synapse-mcp/dist/index.js --vault /path/to/test-vault
```

Expected: Inspector connects, lists 3 tools, can call `search_nodes` with a query and get results from the vault DB.

- [ ] **Step 6: Test with Claude Code**

Add to `.mcp.json` in a test directory:

```json
{
  "mcpServers": {
    "synapse": {
      "command": "node",
      "args": ["/Users/brian/Desktop/code/sideproject/kg_extension/packages/synapse-mcp/dist/index.js", "--vault", "/path/to/test-vault"]
    }
  }
}
```

Start Claude Code, ask "Search my knowledge graph for [topic]" — verify it calls the tool.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat(mcp): add synapse-mcp CLI package for stdio transport"
```

---

## Task 12: Integration testing and cleanup

**Files:**
- Verify all builds
- End-to-end manual testing

- [ ] **Step 1: Full build verification**

```bash
npm run build:electron && npm run build
```

Both must pass cleanly.

- [ ] **Step 2: Test complete client flow**

1. Create `~/Library/Application Support/kg-desktop/mcp-config.json` with a test server (filesystem or a simple echo server)
2. Launch the Electron app with a vault
3. Verify in DevTools: `window.electronIPC.invoke('mcp:list-servers')` shows connected server
4. Verify: `window.electronIPC.invoke('tools:list', {})` shows both built-in and namespaced MCP tools
5. Send a chat message that would use the MCP tool — verify execution works

- [ ] **Step 3: Test complete server flow**

1. Enable MCP server in vault: create `.kg/mcp-server.json` with `{ "enabled": true, "profiles": { "default": { "capabilities": ["read"] } }, "httpTransport": { "port": 19876, "path": "/mcp" } }`
2. Launch app
3. Test with MCP Inspector: `npx @modelcontextprotocol/inspector http://127.0.0.1:19876/mcp`
4. Verify tools are listed and callable

- [ ] **Step 4: Test stdio CLI independently**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | node packages/synapse-mcp/dist/index.js --vault /path/to/test-vault
```

Expected: JSON-RPC response with server capabilities.

- [ ] **Step 5: Verify modularity — remove MCP client**

Temporarily comment out the `McpClientManager` initialization in `main.ts`. Verify:
- App still starts
- Built-in tools still work via `tools:list` and `tools:execute`
- MCP server still works (only exposes built-in tools anyway)

Restore the code after verifying.

- [ ] **Step 6: Add build script for synapse-mcp to root package.json**

Add to root `package.json` scripts:

```json
"build:mcp": "cd packages/synapse-mcp && npm run build"
```

- [ ] **Step 7: Final commit**

```bash
git add -A && git commit -m "feat(mcp): complete integration with build scripts and verification"
```
