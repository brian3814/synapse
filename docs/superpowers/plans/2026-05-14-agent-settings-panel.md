# Agent Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Agent" tab to the Settings modal that lets users customize extraction/chat prompts (append-only), toggle individual tools on/off, and configure per-vault file sandboxing.

**Architecture:** Hybrid storage — prompt and tool config in `PlatformStorage` (app-level, per-user), sandbox rules in `.kg/agent-config.json` (per-vault). Runtime enforcement: prompts append custom instructions, tool arrays are filtered before passing to LLM, file watcher and resource handler check sandbox rules.

**Tech Stack:** React, Zustand, TypeScript, Electron IPC, better-sqlite3, fs (Node)

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `src/shared/agent-settings-types.ts` | `AgentPromptConfig`, `AgentToolConfig`, `VaultSandboxConfig` type definitions + storage key constants |
| `src/ui/components/settings/AgentSettingsTab.tsx` | Main Agent tab with three collapsible sections |
| `src/ui/components/settings/ToolToggleRow.tsx` | Reusable compact tool row with name, description, toggle |
| `src/ui/components/settings/VaultSandboxSection.tsx` | Directory allowlist + extension blocklist UI |

### Modified Files
| File | Change |
|---|---|
| `src/ui/components/settings/SettingsModal.tsx` | Add `'agent'` to `SettingsTab` union and `TABS` array |
| `src/ui/components/settings/SettingsPanel.tsx` | Render `AgentSettingsTab` for `activeTab === 'agent'`, remove `CustomInstructionsSection` from model tab |
| `src/core/system-prompts.ts` | Add optional `customInstructions` param to `getAgentSystemPrompt()` |
| `src/shared/quick-extract-prompt.ts` | Add optional `customInstructions` param to `getQuickExtractSystemPrompt()` |
| `src/core/agent-loop.ts` | Accept `customInstructions` in `AgentLoopConfig`, pass to prompt; accept `disabledTools` and filter `AGENT_TOOLS` |
| `src/ui/hooks/useLLMExtraction.ts` | Read `agentPromptConfig` and `agentToolConfig` from storage, pass to extraction calls |
| `src/ui/hooks/useChatSession.ts` | Read `agentPromptConfig.chatInstructions` instead of `harnessGlobalInstructions` |
| `src/ui/hooks/chat-agent-loop.ts` | Accept `disabledTools` param and filter `CHAT_AGENT_TOOLS` before passing to LLM |
| `electron/vault/vault-context.ts` | Add `sandboxConfig` to `VaultContext` interface, load `.kg/agent-config.json` in `createVaultContext()` |
| `electron/vault/file-watcher.ts` | Accept `VaultSandboxConfig`, apply `blockedExtensions` in `shouldIgnore()` |
| `electron/vault/handlers/resource-detection-handler.ts` | Accept `VaultSandboxConfig`, check `allowedDirs` and `blockedExtensions` before creating resource nodes |
| `electron/main.ts` | Register `vault-workspace:get-sandbox-config` and `vault-workspace:set-sandbox-config` IPC handlers; pass sandbox config to watcher/handler |
| `src/platform/electron/vault-workspace.ts` | Add `getSandboxConfig()` and `setSandboxConfig()` IPC bridge methods |

---

### Task 1: Type Definitions and Storage Keys

**Files:**
- Create: `src/shared/agent-settings-types.ts`

- [ ] **Step 1: Create the type definitions file**

```typescript
// src/shared/agent-settings-types.ts

export interface AgentPromptConfig {
  extractionInstructions: string;
  chatInstructions: string;
}

export interface AgentToolConfig {
  disabledExtractionTools: string[];
  disabledChatTools: string[];
}

export interface VaultSandboxConfig {
  allowedDirs: string[];
  blockedExtensions: string[];
}

export const AGENT_PROMPT_CONFIG_KEY = 'agentPromptConfig';
export const AGENT_TOOL_CONFIG_KEY = 'agentToolConfig';

export const DEFAULT_SANDBOX_CONFIG: VaultSandboxConfig = {
  allowedDirs: [],
  blockedExtensions: ['.env', '.key', '.pem', '.p12', '.pfx'],
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors from the new file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/agent-settings-types.ts
git commit -m "feat(agent-settings): add type definitions and storage key constants"
```

---

### Task 2: Extraction Prompt Custom Instructions

**Files:**
- Modify: `src/core/system-prompts.ts`
- Modify: `src/shared/quick-extract-prompt.ts`

- [ ] **Step 1: Add `customInstructions` param to `getAgentSystemPrompt`**

In `src/core/system-prompts.ts`, change the signature from:

```typescript
export function getAgentSystemPrompt(notesEnabled: boolean): string {
```

to:

```typescript
export function getAgentSystemPrompt(notesEnabled: boolean, customInstructions?: string): string {
```

And append at the end of the return string (before the closing backtick), after the final paragraph:

```typescript
${customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : ''}
```

The full return statement becomes:

```typescript
  return `You are a knowledge graph extraction agent. ...existing prompt text...

Be efficient: don't call tools unnecessarily. If get_page_content gives you everything you need, proceed directly to save_entities.${customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : ''}`;
```

- [ ] **Step 2: Add `customInstructions` param to `getQuickExtractSystemPrompt`**

In `src/shared/quick-extract-prompt.ts`, change the signature from:

```typescript
export function getQuickExtractSystemPrompt(notesEnabled: boolean): string {
```

to:

```typescript
export function getQuickExtractSystemPrompt(notesEnabled: boolean, customInstructions?: string): string {
```

And append at the end of the return string (before the closing backtick):

```typescript
${customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : ''}
```

The return ends:

```typescript
...Return ONLY valid JSON, no other text.${customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : ''}`;
```

- [ ] **Step 3: Verify TypeScript compiles — existing callers are unaffected since param is optional**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/system-prompts.ts src/shared/quick-extract-prompt.ts
git commit -m "feat(agent-settings): add customInstructions param to extraction prompts"
```

---

### Task 3: Chat Prompt Custom Instructions

**Files:**
- Modify: `src/core/prompt-assembler.ts`
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Update `assembleSystemPrompt` to use new storage key**

In `src/core/prompt-assembler.ts`, no changes needed to the function itself — it already accepts `globalInstructions` via `PromptContext` and appends it as `## Custom Instructions`. The interface is stable.

- [ ] **Step 2: Update `useChatSession.ts` to read from `agentPromptConfig`**

In `src/ui/hooks/useChatSession.ts`, find the storage read around line 153:

```typescript
const storageData = await storage.get(['harnessGlobalInstructions', 'harnessPresets', 'harnessActivePresetId']);
const globalInstructions = (storageData as any).harnessGlobalInstructions ?? null;
```

Replace with:

```typescript
const storageData = await storage.get(['agentPromptConfig', 'harnessPresets', 'harnessActivePresetId']);
const promptConfig = (storageData as any).agentPromptConfig as AgentPromptConfig | undefined;
const globalInstructions = promptConfig?.chatInstructions || null;
```

Add import at top:

```typescript
import type { AgentPromptConfig } from '../../shared/agent-settings-types';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/useChatSession.ts
git commit -m "feat(agent-settings): wire chat prompt to agentPromptConfig storage key"
```

---

### Task 4: Extraction Tool Filtering

**Files:**
- Modify: `src/core/agent-loop.ts`
- Modify: `src/ui/hooks/useLLMExtraction.ts`

- [ ] **Step 1: Add `customInstructions` and `disabledTools` to `AgentLoopConfig`**

In `src/core/agent-loop.ts`, update the interface:

```typescript
export interface AgentLoopConfig {
  runId: string;
  userPrompt: string;
  apiKey: string;
  model: string;
  maxIterations?: number;
  notesEnabled?: boolean;
  customInstructions?: string;
  disabledTools?: string[];
}
```

Then update the `runAgentLoop` function body (around line 46-47) from:

```typescript
  const systemPrompt = getAgentSystemPrompt(config.notesEnabled ?? false);
  const anthropicTools = toAnthropicTools(AGENT_TOOLS);
```

to:

```typescript
  const systemPrompt = getAgentSystemPrompt(config.notesEnabled ?? false, config.customInstructions);
  const filteredTools = config.disabledTools?.length
    ? AGENT_TOOLS.filter((t) => t.name === 'save_entities' || !config.disabledTools!.includes(t.name))
    : AGENT_TOOLS;
  const anthropicTools = toAnthropicTools(filteredTools);
```

- [ ] **Step 2: Read agent config in `useLLMExtraction` and pass to extraction calls**

In `src/ui/hooks/useLLMExtraction.ts`, add import:

```typescript
import { AGENT_PROMPT_CONFIG_KEY, AGENT_TOOL_CONFIG_KEY } from '../../shared/agent-settings-types';
import type { AgentPromptConfig, AgentToolConfig } from '../../shared/agent-settings-types';
```

Create a helper inside the hook (or above `startExtraction`):

```typescript
  const getAgentConfig = useCallback(async () => {
    const data = await storage.get([AGENT_PROMPT_CONFIG_KEY, AGENT_TOOL_CONFIG_KEY]);
    const promptConfig = (data as any)[AGENT_PROMPT_CONFIG_KEY] as AgentPromptConfig | undefined;
    const toolConfig = (data as any)[AGENT_TOOL_CONFIG_KEY] as AgentToolConfig | undefined;
    return { promptConfig, toolConfig };
  }, []);
```

Then in `startExtraction` (the quick-extract path), around line 221 where `getQuickExtractSystemPrompt(notesOn)` is called, update to:

```typescript
      const { promptConfig, toolConfig } = await getAgentConfig();
      // ...then in the llm.streamExtraction call:
      systemPrompt: getQuickExtractSystemPrompt(notesOn, promptConfig?.extractionInstructions),
```

In `startAgentExtraction`, around line 557 where the agent is run, add the config to the payload:

```typescript
      const { promptConfig, toolConfig } = await getAgentConfig();
      // ...in the llm.runAgent call payload:
      customInstructions: promptConfig?.extractionInstructions,
      disabledTools: toolConfig?.disabledExtractionTools,
```

In `startIngestion`, around line 1111, update similarly:

```typescript
      const { promptConfig } = await getAgentConfig();
      // ...in the getSystemPrompt wrapper:
      getSystemPrompt: (notesEnabled: boolean) => getQuickExtractSystemPrompt(notesEnabled, promptConfig?.extractionInstructions),
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/core/agent-loop.ts src/ui/hooks/useLLMExtraction.ts
git commit -m "feat(agent-settings): wire extraction prompt + tool filtering to agent config"
```

---

### Task 5: Chat Tool Filtering

**Files:**
- Modify: `src/ui/hooks/chat-agent-loop.ts`
- Modify: `src/ui/hooks/useChatSession.ts`

- [ ] **Step 1: Add `disabledTools` param to `RunChatAgentParams` and filter tools**

In `src/ui/hooks/chat-agent-loop.ts`, update the `RunChatAgentParams` interface:

```typescript
interface RunChatAgentParams {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  currentPrompt: string;
  attachedContext?: string;
  provider: string;
  model: string;
  systemPrompt: string;
  disabledTools?: string[];
  onProgress: (event: ChatAgentProgress) => void;
}
```

Then update `getToolDefs()` to accept disabled tools. Replace:

```typescript
function getToolDefs(): typeof BASE_TOOL_DEFS {
  if (platformId !== 'electron') return BASE_TOOL_DEFS;
  return [...BASE_TOOL_DEFS, SEMANTIC_SEARCH_TOOL];
}
```

with:

```typescript
function getToolDefs(disabledTools?: string[]) {
  let defs = [...CHAT_AGENT_TOOLS];

  if (disabledTools?.length) {
    defs = defs.filter((t) => !disabledTools.includes(t.name));
  }

  const tools = toAnthropicChatTools(defs);

  if (platformId === 'electron' && !disabledTools?.includes('semantic_search')) {
    tools.push(SEMANTIC_SEARCH_TOOL);
  }

  return tools;
}
```

Note: This filters the raw `ChatToolDefinition[]` first, then converts to Anthropic format, then appends `SEMANTIC_SEARCH_TOOL` (which is already in Anthropic format). The original code pre-converted via `BASE_TOOL_DEFS` — this version rebuilds each call but is correct.

In `runChatAgent`, update the call from `getToolDefs()` to `getToolDefs(params.disabledTools)`. Find where tools are passed and update accordingly.

- [ ] **Step 2: Pass `disabledTools` from `useChatSession`**

In `src/ui/hooks/useChatSession.ts`, expand the storage read (from Task 3) to also fetch tool config:

```typescript
const storageData = await storage.get(['agentPromptConfig', 'agentToolConfig', 'harnessPresets', 'harnessActivePresetId']);
const promptConfig = (storageData as any).agentPromptConfig as AgentPromptConfig | undefined;
const toolConfig = (storageData as any).agentToolConfig as AgentToolConfig | undefined;
const globalInstructions = promptConfig?.chatInstructions || null;
```

Add import:

```typescript
import type { AgentPromptConfig, AgentToolConfig } from '../../shared/agent-settings-types';
```

Then pass to `runChatAgent`:

```typescript
const finalText = await runChatAgent({
  conversationHistory: historyForLLM,
  currentPrompt: input,
  attachedContext: serializedContext,
  provider: config.provider,
  model: config.model,
  systemPrompt,
  disabledTools: toolConfig?.disabledChatTools,
  onProgress: (event: ChatAgentProgress) => {
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/ui/hooks/chat-agent-loop.ts src/ui/hooks/useChatSession.ts
git commit -m "feat(agent-settings): wire chat tool filtering to agent config"
```

---

### Task 6: Vault Sandbox Config — Backend

**Files:**
- Modify: `electron/vault/vault-context.ts`
- Modify: `electron/vault/vault-manager.ts`
- Modify: `electron/main.ts`
- Modify: `src/platform/electron/vault-workspace.ts`

- [ ] **Step 1: Add `sandboxConfig` to `VaultContext`**

In `electron/vault/vault-context.ts`, add import:

```typescript
import type { VaultSandboxConfig } from '../../src/shared/agent-settings-types';
import { DEFAULT_SANDBOX_CONFIG } from '../../src/shared/agent-settings-types';
```

Add to the `VaultContext` interface:

```typescript
export interface VaultContext {
  readonly path: string;
  readonly kgPath: string;
  readonly name: string;
  readonly id: string;
  readonly db: Database.Database;
  readonly config: VaultConfig;
  readonly eventBus: VaultEventBus;
  sandboxConfig: VaultSandboxConfig;

  resolve(relativePath: string): string;
  relative(absolutePath: string): string;
}
```

In `createVaultContext`, load the sandbox config from `.kg/agent-config.json`:

```typescript
export function createVaultContext(vaultPath: string, db: Database.Database): VaultContext {
  const kgPath = join(vaultPath, '.kg');
  const configPath = join(kgPath, 'config.json');

  if (!existsSync(configPath)) {
    throw new Error(`Not a valid vault: ${configPath} not found`);
  }

  const config: VaultConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
  const eventBus = new VaultEventBus();

  // Load sandbox config
  const agentConfigPath = join(kgPath, 'agent-config.json');
  let sandboxConfig: VaultSandboxConfig = { ...DEFAULT_SANDBOX_CONFIG };
  if (existsSync(agentConfigPath)) {
    try {
      sandboxConfig = JSON.parse(readFileSync(agentConfigPath, 'utf-8'));
    } catch {
      // Corrupt file — use defaults
    }
  }

  return {
    path: vaultPath,
    kgPath,
    name: config.name,
    id: config.id,
    db,
    config,
    eventBus,
    sandboxConfig,

    resolve(relativePath: string): string {
      return join(vaultPath, relativePath);
    },

    relative(absolutePath: string): string {
      if (!absolutePath.startsWith(vaultPath)) {
        throw new Error(`Path ${absolutePath} is not inside vault ${vaultPath}`);
      }
      return absolutePath.slice(vaultPath.length + 1);
    },
  };
}
```

- [ ] **Step 2: Add IPC handlers in `electron/main.ts`**

After the existing `vault-workspace:close` handler (around line 470), add:

```typescript
  ipcMain.handle('vault-workspace:get-sandbox-config', () => {
    const ctx = vaultManager.getContext();
    if (!ctx) return null;
    return ctx.sandboxConfig;
  });

  ipcMain.handle('vault-workspace:set-sandbox-config', (_event, config: VaultSandboxConfig) => {
    const ctx = vaultManager.getContext();
    if (!ctx) return;
    ctx.sandboxConfig = config;
    const agentConfigPath = join(ctx.kgPath, 'agent-config.json');
    writeFileSync(agentConfigPath, JSON.stringify(config, null, 2), 'utf-8');
  });
```

Add imports at top of `electron/main.ts`:

```typescript
import { writeFileSync } from 'fs';
import type { VaultSandboxConfig } from '../src/shared/agent-settings-types';
```

Note: `join` from `path` should already be imported. Check and add if missing.

- [ ] **Step 3: Add IPC bridge in `src/platform/electron/vault-workspace.ts`**

Add import and methods:

```typescript
import type { VaultSandboxConfig } from '../../shared/agent-settings-types';
```

Add to the `vaultWorkspace` object:

```typescript
  async getSandboxConfig(): Promise<VaultSandboxConfig | null> {
    return window.electronIPC.invoke('vault-workspace:get-sandbox-config') as Promise<VaultSandboxConfig | null>;
  },

  async setSandboxConfig(config: VaultSandboxConfig): Promise<void> {
    await window.electronIPC.invoke('vault-workspace:set-sandbox-config', config);
  },
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add electron/vault/vault-context.ts electron/main.ts src/platform/electron/vault-workspace.ts
git commit -m "feat(agent-settings): vault sandbox config backend + IPC"
```

---

### Task 7: Vault Sandbox Enforcement

**Files:**
- Modify: `electron/vault/file-watcher.ts`
- Modify: `electron/vault/handlers/resource-detection-handler.ts`
- Modify: `electron/main.ts`

- [ ] **Step 1: Add sandbox filtering to `VaultFileWatcher`**

In `electron/vault/file-watcher.ts`, add import and accept sandbox config:

```typescript
import type { VaultSandboxConfig } from '../../src/shared/agent-settings-types';
```

Update the constructor to accept a mutable reference to sandbox config:

```typescript
export class VaultFileWatcher {
  private watcher: FSWatcher | null = null;
  private vaultPath: string;
  private eventBus: VaultEventBus;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private recentlyWritten = new Set<string>();
  private getSandboxConfig: () => VaultSandboxConfig;

  constructor(vaultPath: string, eventBus: VaultEventBus, getSandboxConfig: () => VaultSandboxConfig) {
    this.vaultPath = vaultPath;
    this.eventBus = eventBus;
    this.getSandboxConfig = getSandboxConfig;
  }
```

Update `shouldIgnore` to also check sandbox rules:

```typescript
  private shouldIgnore(relativePath: string): boolean {
    const parts = relativePath.split('/');

    // Ignore files in ignored directories
    for (const part of parts.slice(0, -1)) {
      if (IGNORE_DIRS.has(part)) return true;
    }

    // Ignore files in notes/ (app-managed by NoteFileHandler)
    if (parts[0] === 'notes') return true;

    // Ignore specific filenames
    const filename = parts[parts.length - 1];
    if (IGNORE_FILES.has(filename)) return true;

    // Sandbox: blocked extensions
    const sandbox = this.getSandboxConfig();
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    if (ext && sandbox.blockedExtensions.includes(ext.toLowerCase())) return true;

    // Sandbox: allowed directories (empty = allow all)
    if (sandbox.allowedDirs.length > 0) {
      const inAllowed = sandbox.allowedDirs.some((dir) => relativePath.startsWith(dir));
      if (!inAllowed) return true;
    }

    return false;
  }
```

- [ ] **Step 2: Add sandbox check to `ResourceDetectionHandler`**

In `electron/vault/handlers/resource-detection-handler.ts`, add import:

```typescript
import type { VaultSandboxConfig } from '../../../src/shared/agent-settings-types';
```

Update constructor to accept sandbox config getter:

```typescript
export class ResourceDetectionHandler {
  private ctx: VaultContext;
  private unsubscribers: (() => void)[] = [];
  private getSandboxConfig: () => VaultSandboxConfig;

  constructor(ctx: VaultContext, getSandboxConfig: () => VaultSandboxConfig) {
    this.ctx = ctx;
    this.getSandboxConfig = getSandboxConfig;
  }
```

Add a sandbox check at the top of `handleFileAdded`:

```typescript
  private handleFileAdded(relativePath: string): void {
    // Sandbox check
    const sandbox = this.getSandboxConfig();
    const ext = extname(relativePath).toLowerCase();
    if (ext && sandbox.blockedExtensions.includes(ext)) return;
    if (sandbox.allowedDirs.length > 0) {
      const inAllowed = sandbox.allowedDirs.some((dir) => relativePath.startsWith(dir));
      if (!inAllowed) return;
    }

    // Check if a node already exists for this path
    const existing = this.ctx.db.prepare(
```

- [ ] **Step 3: Update `registerVaultHandlers` in `electron/main.ts` to pass sandbox config**

In `electron/main.ts`, update `registerVaultHandlers`:

```typescript
  function registerVaultHandlers() {
    const ctx = vaultManager.getContext();
    if (!ctx) return;

    reconcileVault(ctx);

    noteFileHandler = new NoteFileHandler(ctx);
    noteFileHandler.register(ctx.eventBus);

    syncBroadcastHandler = new SyncBroadcastHandler();
    syncBroadcastHandler.register(ctx.eventBus);

    const getSandboxConfig = () => vaultManager.getContext()!.sandboxConfig;

    resourceDetectionHandler = new ResourceDetectionHandler(ctx, getSandboxConfig);
    resourceDetectionHandler.register(ctx.eventBus);

    fileWatcher = new VaultFileWatcher(ctx.path, ctx.eventBus, getSandboxConfig);
    fileWatcher.start();
  }
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add electron/vault/file-watcher.ts electron/vault/handlers/resource-detection-handler.ts electron/main.ts
git commit -m "feat(agent-settings): enforce vault sandbox rules in file watcher + resource handler"
```

---

### Task 8: ToolToggleRow Component

**Files:**
- Create: `src/ui/components/settings/ToolToggleRow.tsx`

- [ ] **Step 1: Create the ToolToggleRow component**

```typescript
// src/ui/components/settings/ToolToggleRow.tsx

interface ToolToggleRowProps {
  name: string;
  description: string;
  enabled: boolean;
  locked?: boolean;
  variant?: 'default' | 'destructive';
  onToggle: (name: string, enabled: boolean) => void;
}

export function ToolToggleRow({ name, description, enabled, locked, variant, onToggle }: ToolToggleRowProps) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 px-2 rounded ${
        variant === 'destructive' ? 'bg-red-950/20' : ''
      }`}
    >
      <div className="min-w-0 flex-1 mr-3">
        <span className="text-xs font-mono text-zinc-200">{name}</span>
        <span className="text-[10px] text-zinc-500 ml-2">{description}</span>
      </div>
      <input
        type="checkbox"
        checked={enabled}
        disabled={locked}
        onChange={() => onToggle(name, !enabled)}
        className={`toggle-switch shrink-0 ${locked ? 'opacity-40 cursor-not-allowed' : ''}`}
      />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/settings/ToolToggleRow.tsx
git commit -m "feat(agent-settings): add ToolToggleRow component"
```

---

### Task 9: VaultSandboxSection Component

**Files:**
- Create: `src/ui/components/settings/VaultSandboxSection.tsx`

- [ ] **Step 1: Create the VaultSandboxSection component**

```typescript
// src/ui/components/settings/VaultSandboxSection.tsx

import { useState, useEffect } from 'react';
import { vaultWorkspace } from '@platform';
import type { VaultSandboxConfig } from '../../../shared/agent-settings-types';
import { DEFAULT_SANDBOX_CONFIG } from '../../../shared/agent-settings-types';

export function VaultSandboxSection() {
  const [vaultOpen, setVaultOpen] = useState(false);
  const [config, setConfig] = useState<VaultSandboxConfig>({ ...DEFAULT_SANDBOX_CONFIG });
  const [saved, setSaved] = useState(false);
  const [newDir, setNewDir] = useState('');
  const [newExt, setNewExt] = useState('');

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      setVaultOpen(status.open);
      if (status.open) {
        vaultWorkspace.getSandboxConfig().then((cfg) => {
          if (cfg) setConfig(cfg);
        });
      }
    });
  }, []);

  const handleSave = async (updated: VaultSandboxConfig) => {
    setConfig(updated);
    await vaultWorkspace.setSandboxConfig(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const addDir = () => {
    const dir = newDir.trim().replace(/\/$/, '') + '/';
    if (!dir || dir === '/' || config.allowedDirs.includes(dir)) return;
    handleSave({ ...config, allowedDirs: [...config.allowedDirs, dir] });
    setNewDir('');
  };

  const removeDir = (dir: string) => {
    handleSave({ ...config, allowedDirs: config.allowedDirs.filter((d) => d !== dir) });
  };

  const addExt = () => {
    let ext = newExt.trim().toLowerCase();
    if (!ext.startsWith('.')) ext = '.' + ext;
    if (ext === '.' || config.blockedExtensions.includes(ext)) return;
    handleSave({ ...config, blockedExtensions: [...config.blockedExtensions, ext] });
    setNewExt('');
  };

  const removeExt = (ext: string) => {
    handleSave({ ...config, blockedExtensions: config.blockedExtensions.filter((e) => e !== ext) });
  };

  return (
    <div className="border-t border-zinc-700 pt-4 mt-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-zinc-400">Vault Sandbox</h4>
        {saved && <span className="text-[10px] text-green-400">Saved!</span>}
      </div>

      {!vaultOpen ? (
        <p className="text-[10px] text-zinc-600">Open a vault to configure sandbox rules.</p>
      ) : (
        <div className="space-y-4">
          <p className="text-[10px] text-zinc-600">
            Stored in this vault — rules apply per-vault.
          </p>

          {/* Allowed Directories */}
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Allowed Directories</label>
            <p className="text-[10px] text-zinc-600 mb-1.5">Empty = full vault access.</p>
            <div className="space-y-1 mb-1.5">
              {config.allowedDirs.map((dir) => (
                <div key={dir} className="flex items-center gap-1">
                  <span className="text-xs font-mono text-zinc-300 bg-zinc-800 rounded px-1.5 py-0.5 flex-1">{dir}</span>
                  <button
                    onClick={() => removeDir(dir)}
                    className="text-zinc-500 hover:text-red-400 text-xs px-1"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={newDir}
                onChange={(e) => setNewDir(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addDir()}
                placeholder="e.g. research/"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button onClick={addDir} className="px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded hover:bg-zinc-600">
                +
              </button>
            </div>
          </div>

          {/* Blocked Extensions */}
          <div>
            <label className="text-[10px] text-zinc-500 block mb-1">Blocked File Extensions</label>
            <div className="flex flex-wrap gap-1 mb-1.5">
              {config.blockedExtensions.map((ext) => (
                <span key={ext} className="inline-flex items-center bg-zinc-800 text-zinc-300 text-xs rounded px-1.5 py-0.5 font-mono">
                  {ext}
                  <button
                    onClick={() => removeExt(ext)}
                    className="ml-1 text-zinc-500 hover:text-red-400"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex gap-1">
              <input
                type="text"
                value={newExt}
                onChange={(e) => setNewExt(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addExt()}
                placeholder="e.g. .secret"
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
              />
              <button onClick={addExt} className="px-2 py-1 bg-zinc-700 text-zinc-300 text-xs rounded hover:bg-zinc-600">
                +
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors. Note: `vaultWorkspace.getSandboxConfig()` and `setSandboxConfig()` were added in Task 6.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/settings/VaultSandboxSection.tsx
git commit -m "feat(agent-settings): add VaultSandboxSection component"
```

---

### Task 10: AgentSettingsTab Component

**Files:**
- Create: `src/ui/components/settings/AgentSettingsTab.tsx`

- [ ] **Step 1: Create the main Agent tab component**

```typescript
// src/ui/components/settings/AgentSettingsTab.tsx

import { useState, useEffect, useCallback } from 'react';
import { storage } from '@platform';
import { getAgentSystemPrompt } from '../../../core/system-prompts';
import { getQuickExtractSystemPrompt } from '../../../shared/quick-extract-prompt';
import { BASE_CHAT_SYSTEM_PROMPT } from '../../../core/prompt-assembler';
import { AGENT_TOOLS } from '../../../shared/agent-tools';
import { CHAT_AGENT_TOOLS } from '../../../shared/chat-agent-tools';
import {
  AGENT_PROMPT_CONFIG_KEY,
  AGENT_TOOL_CONFIG_KEY,
} from '../../../shared/agent-settings-types';
import type { AgentPromptConfig, AgentToolConfig } from '../../../shared/agent-settings-types';
import { ToolToggleRow } from './ToolToggleRow';
import { VaultSandboxSection } from './VaultSandboxSection';

const CHAT_TOOL_CATEGORIES: Record<string, { tools: string[]; variant?: 'destructive' }> = {
  Read: {
    tools: ['search_knowledge', 'search_nodes', 'get_node_details', 'get_neighbors', 'get_edges_for_node', 'search_sources', 'get_source_content'],
  },
  Write: {
    tools: ['create_node', 'update_node', 'create_edge', 'index_notes_folder', 'manage_memory'],
  },
  Destructive: {
    tools: ['delete_node', 'merge_nodes'],
    variant: 'destructive',
  },
};

export function AgentSettingsTab() {
  const [promptConfig, setPromptConfig] = useState<AgentPromptConfig>({
    extractionInstructions: '',
    chatInstructions: '',
  });
  const [toolConfig, setToolConfig] = useState<AgentToolConfig>({
    disabledExtractionTools: [],
    disabledChatTools: [],
  });
  const [savedPrompt, setSavedPrompt] = useState(false);
  const [showExtractionPrompt, setShowExtractionPrompt] = useState(false);
  const [showChatPrompt, setShowChatPrompt] = useState(false);

  useEffect(() => {
    storage.get([AGENT_PROMPT_CONFIG_KEY, AGENT_TOOL_CONFIG_KEY]).then((data: Record<string, any>) => {
      if (data[AGENT_PROMPT_CONFIG_KEY]) setPromptConfig(data[AGENT_PROMPT_CONFIG_KEY]);
      if (data[AGENT_TOOL_CONFIG_KEY]) setToolConfig(data[AGENT_TOOL_CONFIG_KEY]);
    }).catch(() => {});
  }, []);

  const savePromptConfig = useCallback(async (updated: AgentPromptConfig) => {
    setPromptConfig(updated);
    await storage.set({ [AGENT_PROMPT_CONFIG_KEY]: updated });
    setSavedPrompt(true);
    setTimeout(() => setSavedPrompt(false), 2000);
  }, []);

  const saveToolConfig = useCallback(async (updated: AgentToolConfig) => {
    setToolConfig(updated);
    await storage.set({ [AGENT_TOOL_CONFIG_KEY]: updated });
  }, []);

  const handleExtractionToolToggle = useCallback((name: string, enabled: boolean) => {
    const updated = {
      ...toolConfig,
      disabledExtractionTools: enabled
        ? toolConfig.disabledExtractionTools.filter((t) => t !== name)
        : [...toolConfig.disabledExtractionTools, name],
    };
    saveToolConfig(updated);
  }, [toolConfig, saveToolConfig]);

  const handleChatToolToggle = useCallback((name: string, enabled: boolean) => {
    const updated = {
      ...toolConfig,
      disabledChatTools: enabled
        ? toolConfig.disabledChatTools.filter((t) => t !== name)
        : [...toolConfig.disabledChatTools, name],
    };
    saveToolConfig(updated);
  }, [toolConfig, saveToolConfig]);

  const allExtractionDisabled = AGENT_TOOLS.filter((t) => t.name !== 'save_entities').every(
    (t) => toolConfig.disabledExtractionTools.includes(t.name)
  );

  const chatReadDisabled = CHAT_TOOL_CATEGORIES.Read.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );
  const chatWriteDisabled = CHAT_TOOL_CATEGORIES.Write.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );
  const chatDestructiveDisabled = CHAT_TOOL_CATEGORIES.Destructive.tools.every(
    (t) => toolConfig.disabledChatTools.includes(t)
  );

  return (
    <div className="p-5 space-y-0">
      {/* ── Extraction Agent ────────────────────────────────────── */}
      <div>
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Extraction Agent</h3>

        <button
          onClick={() => setShowExtractionPrompt(!showExtractionPrompt)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 mb-2"
        >
          {showExtractionPrompt ? '▼ Hide default prompt' : '▶ View default prompt'}
        </button>
        {showExtractionPrompt && (
          <pre className="text-[10px] text-zinc-500 bg-zinc-800/50 border border-zinc-700 rounded p-2 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {getAgentSystemPrompt(false)}
            {'\n\n---\n\nQuick extract variant:\n\n'}
            {getQuickExtractSystemPrompt(false)}
          </pre>
        )}

        <div className="mb-3">
          <label className="text-[10px] text-zinc-500 block mb-1">Custom Instructions</label>
          <p className="text-[10px] text-zinc-600 mb-1">Appended after the default prompt when extracting from pages or text.</p>
          <textarea
            value={promptConfig.extractionInstructions}
            onChange={(e) => setPromptConfig({ ...promptConfig, extractionInstructions: e.target.value })}
            placeholder="e.g., Always include dates as properties. Focus on technology entities."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
          />
          <button
            onClick={() => savePromptConfig(promptConfig)}
            className="mt-1.5 w-full bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-500 transition-colors"
          >
            {savedPrompt ? 'Saved!' : 'Save Instructions'}
          </button>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tools</label>
          {allExtractionDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All tools disabled — extraction agent can only observe.</p>
          )}
          <div className="space-y-0.5">
            {AGENT_TOOLS.map((tool) => (
              <ToolToggleRow
                key={tool.name}
                name={tool.name}
                description={tool.description.slice(0, 80) + (tool.description.length > 80 ? '…' : '')}
                enabled={!toolConfig.disabledExtractionTools.includes(tool.name)}
                locked={tool.name === 'save_entities'}
                onToggle={handleExtractionToolToggle}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Chat Agent ──────────────────────────────────────────── */}
      <div className="border-t border-zinc-700 pt-4 mt-4">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide mb-3">Chat Agent</h3>

        <button
          onClick={() => setShowChatPrompt(!showChatPrompt)}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 mb-2"
        >
          {showChatPrompt ? '▼ Hide default prompt' : '▶ View default prompt'}
        </button>
        {showChatPrompt && (
          <pre className="text-[10px] text-zinc-500 bg-zinc-800/50 border border-zinc-700 rounded p-2 mb-3 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono">
            {BASE_CHAT_SYSTEM_PROMPT}
          </pre>
        )}

        <div className="mb-3">
          <label className="text-[10px] text-zinc-500 block mb-1">Custom Instructions</label>
          <p className="text-[10px] text-zinc-600 mb-1">Appended after the default prompt for every chat session.</p>
          <textarea
            value={promptConfig.chatInstructions}
            onChange={(e) => setPromptConfig({ ...promptConfig, chatInstructions: e.target.value })}
            placeholder="e.g., I'm a researcher in AI safety. Always cite sources. Respond in bullet points."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
          />
          <button
            onClick={() => savePromptConfig(promptConfig)}
            className="mt-1.5 w-full bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-500 transition-colors"
          >
            {savedPrompt ? 'Saved!' : 'Save Instructions'}
          </button>
        </div>

        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tools</label>
          {chatReadDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All read tools disabled — agent can't search the graph.</p>
          )}
          {chatWriteDisabled && (
            <p className="text-[10px] text-amber-400 mb-1">All write tools disabled — agent can't modify the graph.</p>
          )}
          {chatDestructiveDisabled && (
            <p className="text-[10px] text-zinc-500 mb-1">Destructive tools disabled.</p>
          )}
          <div className="space-y-2">
            {Object.entries(CHAT_TOOL_CATEGORIES).map(([category, { tools: toolNames, variant }]) => (
              <div key={category}>
                <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">{category}</span>
                <div className="space-y-0.5 mt-0.5">
                  {toolNames.map((name) => {
                    const tool = CHAT_AGENT_TOOLS.find((t) => t.name === name);
                    if (!tool) return null;
                    return (
                      <ToolToggleRow
                        key={name}
                        name={name}
                        description={tool.description.slice(0, 80) + (tool.description.length > 80 ? '…' : '')}
                        enabled={!toolConfig.disabledChatTools.includes(name)}
                        variant={variant}
                        onToggle={handleChatToolToggle}
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Vault Sandbox ───────────────────────────────────────── */}
      <VaultSandboxSection />
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/components/settings/AgentSettingsTab.tsx
git commit -m "feat(agent-settings): add AgentSettingsTab component"
```

---

### Task 11: Wire Agent Tab into Settings Modal

**Files:**
- Modify: `src/ui/components/settings/SettingsModal.tsx`
- Modify: `src/ui/components/settings/SettingsPanel.tsx`

- [ ] **Step 1: Add `'agent'` to `SettingsTab` type and `TABS` array**

In `src/ui/components/settings/SettingsModal.tsx`, change:

```typescript
export type SettingsTab = 'general' | 'model' | 'billing' | 'about';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'billing', label: 'Billing' },
  { id: 'about', label: 'About' },
];
```

to:

```typescript
export type SettingsTab = 'general' | 'model' | 'agent' | 'billing' | 'about';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'agent', label: 'Agent' },
  { id: 'billing', label: 'Billing' },
  { id: 'about', label: 'About' },
];
```

- [ ] **Step 2: Add Agent tab rendering and remove CustomInstructionsSection from Model tab**

In `src/ui/components/settings/SettingsPanel.tsx`:

Add import:

```typescript
import { AgentSettingsTab } from './AgentSettingsTab';
```

Add before the `if (activeTab === 'model')` block:

```typescript
  if (activeTab === 'agent') {
    return <AgentSettingsTab />;
  }
```

In the `if (activeTab === 'model')` block, remove the `<CustomInstructionsSection />` line (line 126).

Remove the import of `CustomInstructionsSection` from the imports at top (line 10):

```typescript
// REMOVE this line:
import { CustomInstructionsSection } from './CustomInstructionsSection';
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Build and test**

Run: `npm run build:electron`
Expected: Build succeeds.

Run: `npx electron .`
Expected: Settings modal shows 5 tabs. Agent tab renders extraction/chat sections with prompt display, custom instructions textarea, tool toggle rows, and vault sandbox section.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/settings/SettingsModal.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(agent-settings): wire Agent tab into settings modal"
```

---

### Task 12: Chrome Platform Stub for getSandboxConfig

**Files:**
- Modify: `src/platform/chrome/vault-workspace.ts` (if it exists — check first)

- [ ] **Step 1: Check if Chrome vault-workspace needs updating**

Run: `cat src/platform/chrome/vault-workspace.ts`

If the file exists and exports a `vaultWorkspace` object, add stub methods:

```typescript
  async getSandboxConfig() {
    return null;
  },

  async setSandboxConfig() {
    // no-op on Chrome
  },
```

If the file doesn't exist, check how Chrome platform exports vault-workspace and add stubs accordingly.

- [ ] **Step 2: Verify TypeScript compiles for both platforms**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Commit (if changes were needed)**

```bash
git add src/platform/chrome/vault-workspace.ts
git commit -m "feat(agent-settings): add Chrome stub for sandbox config"
```

---

### Task 13: Cleanup — Delete Orphaned CustomInstructionsSection

**Files:**
- Delete: `src/ui/components/settings/CustomInstructionsSection.tsx`

- [ ] **Step 1: Verify no remaining imports**

Run: `grep -rn "CustomInstructionsSection" --include="*.ts" --include="*.tsx"`

Expected: No results (the import was removed in Task 11).

- [ ] **Step 2: Delete the file**

```bash
rm src/ui/components/settings/CustomInstructionsSection.tsx
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add -u src/ui/components/settings/CustomInstructionsSection.tsx
git commit -m "chore: remove orphaned CustomInstructionsSection (moved to Agent tab)"
```

---

### Task 14: End-to-End Verification

**Files:** None — manual testing only.

- [ ] **Step 1: Build electron app**

Run: `npm run build:electron`
Expected: Build succeeds with no errors.

- [ ] **Step 2: Launch and test Agent tab**

Run: `npx electron .`

Verify:
1. Settings modal → Agent tab is visible between Model and Billing
2. Extraction Agent section:
   - "View default prompt" disclosure toggles and shows the prompt text
   - Custom instructions textarea saves and shows "Saved!"
   - Tool toggles work — clicking a toggle changes its state
   - `save_entities` toggle is greyed out / non-clickable
   - Disabling all tools shows warning message
3. Chat Agent section:
   - Same prompt/instructions behavior
   - Tools grouped into Read/Write/Destructive
   - Destructive rows have subtle red background
4. Vault Sandbox section:
   - Shows "Open a vault to configure sandbox rules" if no vault open
   - With vault open: directory list + extension chips work
   - Adding/removing dirs and extensions persists (close and reopen settings)
5. Model tab no longer shows Custom Instructions section
6. Previously saved `harnessGlobalInstructions` no longer affects chat (new key is used)

- [ ] **Step 3: Test runtime integration**

1. Add custom extraction instructions (e.g., "Always tag entities with 'test'")
2. Run a text extraction — verify the instruction appears in the LLM behavior
3. Disable a chat tool (e.g., `delete_node`) — verify the agent reports it's unavailable when asked to delete
4. Add a blocked extension (e.g., `.txt`) — drop a `.txt` file in vault — verify no resource node is created
5. Remove the blocked extension — drop another `.txt` file — verify resource node IS created

- [ ] **Step 4: Final commit if any fixes were needed**
