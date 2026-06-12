# Agent Context & Per-Feature Assignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make agent custom instructions actually reach extraction, and add per-feature agent assignment (extraction agent, default chat agent) via a Settings page — per `docs/superpowers/specs/2026-06-12-extraction-agent-context-design.md`.

**Architecture:** Pure resolution logic (`selectExtractionAgent`, `toPromptContext`, `FeatureAgentMap`) lives in platform-free `src/shared/agent-definition-types.ts` (vitest-importable). The zustand agent store gains `featureAgents` state + a thin `getExtractionAgent` selector. All four extraction modes in `useLLMExtraction.ts` consume the resolved agent instead of the dead legacy `agentPromptConfig` key. A new Settings "Agents" tab assigns agents to features; the Agents panel gains extraction-agent creation. Legacy dead code is deleted.

**Tech Stack:** TypeScript, React, Zustand, vitest. Repo: `/Users/brian/Desktop/code/sideproject/kg_extension`.

**Execution rules (from prior incidents):** NEVER `git checkout`/`switch`/`reset`/`stash` in the shared worktree (inspect history via `git show`/`git diff` only). NEVER `git add -A`/`git add .` — stage explicit paths (an unrelated untracked spec doc may exist). Run `git branch --show-current` before each commit; it must print `agent-context`.

---

### Task 0: Preflight

**Files:** none (environment)

- [ ] **Step 1: Branch + baseline**

```bash
cd /Users/brian/Desktop/code/sideproject/kg_extension
git checkout -b agent-context   # the ONE permitted checkout: creating the work branch from desktop
npm test
```
Expected: branch created from `desktop`; 53/53 tests pass. If the tree has uncommitted user changes, leave them untouched and proceed (they ride along; never stage them).

---

### Task 1: Shared types + pure resolution logic (TDD)

**Files:**
- Modify: `src/shared/agent-definition-types.ts` (append after the `toToolFilter` function, before the `// --- Frontmatter Parser ---` section)
- Test: Create `tests/agents/extraction-agent.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/agents/extraction-agent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENTS,
  selectExtractionAgent,
  toPromptContext,
  type AgentDefinition,
} from '../../src/shared/agent-definition-types';
import { getQuickExtractSystemPrompt } from '../../src/shared/quick-extract-prompt';

function makeAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'x',
    name: 'x',
    description: '',
    icon: '🤖',
    kind: 'extraction',
    scope: 'user',
    enabled: true,
    customInstructions: '',
    conversationStarters: [],
    maxIterations: 15,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const builtinChat = DEFAULT_AGENTS.find(a => a.id === 'chat')!;
const builtinExtraction = DEFAULT_AGENTS.find(a => a.id === 'extraction')!;

describe('selectExtractionAgent', () => {
  it('returns the builtin extraction agent when no preference is set', () => {
    const agents = [builtinChat, builtinExtraction];
    expect(selectExtractionAgent(agents).id).toBe('extraction');
  });

  it('honors a valid preferred agent', () => {
    const custom = makeAgent({ id: 'user:my-extractor', name: 'my-extractor' });
    const agents = [builtinChat, builtinExtraction, custom];
    expect(selectExtractionAgent(agents, 'user:my-extractor').id).toBe('user:my-extractor');
  });

  it('falls back to the builtin when the preferred agent is disabled', () => {
    const custom = makeAgent({ id: 'user:my-extractor', enabled: false });
    const agents = [builtinChat, builtinExtraction, custom];
    expect(selectExtractionAgent(agents, 'user:my-extractor').id).toBe('extraction');
  });

  it('falls back when the preferred id points at a chat agent', () => {
    const agents = [builtinChat, builtinExtraction];
    expect(selectExtractionAgent(agents, 'chat').id).toBe('extraction');
  });

  it('uses the first enabled extraction agent when the builtin is disabled', () => {
    const disabledBuiltin = { ...builtinExtraction, enabled: false };
    const vaultAgent = makeAgent({ id: 'vault:my-extractor', scope: 'vault' });
    const agents = [builtinChat, disabledBuiltin, vaultAgent];
    expect(selectExtractionAgent(agents).id).toBe('vault:my-extractor');
  });

  it('falls back to the builtin default when every extraction agent is disabled', () => {
    const disabledBuiltin = { ...builtinExtraction, enabled: false };
    const agents = [builtinChat, disabledBuiltin];
    const resolved = selectExtractionAgent(agents);
    expect(resolved.id).toBe('extraction');
    expect(resolved.enabled).toBe(true); // the pristine DEFAULT_AGENTS entry
  });
});

describe('toPromptContext', () => {
  it('passes instructions through', () => {
    const agent = makeAgent({ customInstructions: 'Treat names as attributes.' });
    expect(toPromptContext(agent)).toEqual({ instructions: 'Treat names as attributes.' });
  });

  it('normalizes empty and whitespace-only instructions to undefined', () => {
    expect(toPromptContext(makeAgent({ customInstructions: '' })).instructions).toBeUndefined();
    expect(toPromptContext(makeAgent({ customInstructions: '   \n ' })).instructions).toBeUndefined();
  });
});

describe('extraction prompt instruction injection (regression for the dropped-instructions bug)', () => {
  it('emits a Custom Instructions block when instructions are provided', () => {
    const prompt = getQuickExtractSystemPrompt(false, 'AVOID person names as nodes');
    expect(prompt).toContain('## Custom Instructions');
    expect(prompt).toContain('AVOID person names as nodes');
  });

  it('emits no Custom Instructions block when instructions are undefined', () => {
    const prompt = getQuickExtractSystemPrompt(false, undefined);
    expect(prompt).not.toContain('## Custom Instructions');
  });
});
```

- [ ] **Step 2: Run to verify RED**

Run: `npx vitest run tests/agents/extraction-agent.test.ts`
Expected: FAIL — `selectExtractionAgent`/`toPromptContext` are not exported (the two prompt-injection tests pass; the import error fails the file).

- [ ] **Step 3: Implement** — in `src/shared/agent-definition-types.ts`, insert directly after the closing brace of `toToolFilter(...)` and before `// --- Frontmatter Parser ---`:

```typescript
// --- Per-feature agent assignment ---

export type CoreFeature = 'extraction' | 'chat';

export interface FeatureAgentMap {
  extraction?: string;
  chat?: string;
}

export const FEATURE_AGENTS_KEY = 'featureAgents';

/**
 * Prompt-relevant context derived from an agent definition. Extend this
 * interface (and toPromptContext) when new per-agent context lands —
 * consumers pick up new fields without signature changes.
 */
export interface AgentPromptContext {
  instructions?: string;
}

export function toPromptContext(agent: AgentDefinition): AgentPromptContext {
  const instructions = agent.customInstructions?.trim();
  return { instructions: instructions ? instructions : undefined };
}

/**
 * Resolve the extraction agent: explicit preference (if it exists, is enabled,
 * and is extraction-kind) → builtin 'extraction' if enabled → first enabled
 * extraction agent (vault agents merge into the list) → pristine builtin
 * default. Never undefined: extraction must not break because of agent
 * management actions.
 */
export function selectExtractionAgent(
  agents: AgentDefinition[],
  preferredId?: string,
): AgentDefinition {
  if (preferredId) {
    const preferred = agents.find(
      a => a.id === preferredId && a.enabled && a.kind === 'extraction',
    );
    if (preferred) return preferred;
  }
  const builtin = agents.find(a => a.id === 'extraction' && a.enabled);
  if (builtin) return builtin;
  const firstEnabled = agents.find(a => a.kind === 'extraction' && a.enabled);
  if (firstEnabled) return firstEnabled;
  return DEFAULT_AGENTS.find(a => a.id === 'extraction')!;
}
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npx vitest run tests/agents/extraction-agent.test.ts && npm test`
Expected: new file 10/10; whole suite green (63 total).

- [ ] **Step 5: Commit**

```bash
git add src/shared/agent-definition-types.ts tests/agents/extraction-agent.test.ts
git commit -m "feat(agents): pure extraction-agent resolution and prompt-context derivation"
```

---

### Task 2: Agent store — featureAgents state + selectors

**Files:**
- Modify: `src/graph/store/agent-store.ts`

- [ ] **Step 1: Extend imports and the store interface**

In the import from `'../../shared/agent-definition-types'` (top of file), add `selectExtractionAgent`, `FEATURE_AGENTS_KEY`, and types `FeatureAgentMap`, `CoreFeature`.

In `interface AgentStore` add:

```typescript
  featureAgents: FeatureAgentMap;
  setFeatureAgent: (feature: CoreFeature, agentId: string | null) => Promise<void>;
```

- [ ] **Step 2: Load + persist the map**

In the store initializer add `featureAgents: {},` next to `loaded: false`.

In `loadAgents()`:
- change the storage read to `storage.get([AGENT_OVERRIDES_KEY, ACTIVE_AGENT_KEY, FEATURE_AGENTS_KEY])`;
- after the overrides/vault merge add `const featureAgents = (raw[FEATURE_AGENTS_KEY] as FeatureAgentMap) || {};`;
- change the active-id line to `const activeId = (raw[ACTIVE_AGENT_KEY] as string) || featureAgents.chat || 'chat';`;
- include it in the final set: `set({ agents, activeAgentId: activeId, featureAgents, loaded: true });`.

Add the action (next to `setActiveAgent`):

```typescript
  setFeatureAgent: async (feature, agentId) => {
    const next = { ...get().featureAgents };
    if (agentId) next[feature] = agentId;
    else delete next[feature];
    set({ featureAgents: next });
    await storage.set({ [FEATURE_AGENTS_KEY]: next }).catch(() => {});
  },
```

- [ ] **Step 3: Selectors — chat default chain + extraction resolver**

Replace the body of the existing `getActiveAgent` (keep its current `export` status exactly as-is):

```typescript
export function getActiveAgent(state: AgentStore): AgentDefinition {
  const resolve = (id?: string) =>
    id ? state.agents.find(a => a.id === id && a.enabled && a.kind === 'chat') : undefined;
  return resolve(state.activeAgentId)
    ?? resolve(state.featureAgents.chat)
    ?? state.agents.find(a => a.id === 'chat')
    ?? state.agents[0];
}
```

(Behavior change is intentional per spec: a disabled/deleted active agent now falls back to the assigned default instead of being used anyway.)

Add below `getActiveToolFilter`:

```typescript
export function getExtractionAgent(state: AgentStore): AgentDefinition {
  return selectExtractionAgent(state.agents, state.featureAgents.extraction);
}
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test && npm run build:electron`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add src/graph/store/agent-store.ts
git commit -m "feat(agents): featureAgents assignment state, chat default chain, extraction selector"
```

---

### Task 3: Repoint extraction + delete legacy dead code

**Files:**
- Modify: `src/ui/hooks/useLLMExtraction.ts`
- Delete: `src/ui/components/settings/AgentSettingsTab.tsx`
- Possibly delete: `src/ui/components/settings/ToolToggleRow.tsx` (only if its sole consumer was AgentSettingsTab — verify in Step 3)

- [ ] **Step 1: Swap the config source** — in `src/ui/hooks/useLLMExtraction.ts`:

Replace the two legacy import lines

```typescript
import { AGENT_PROMPT_CONFIG_KEY, AGENT_TOOL_CONFIG_KEY } from '../../shared/agent-settings-types';
import type { AgentPromptConfig, AgentToolConfig } from '../../shared/agent-settings-types';
```

with

```typescript
import { useAgentStore, getExtractionAgent } from '../../graph/store/agent-store';
import { toPromptContext } from '../../shared/agent-definition-types';
```

Replace the `getAgentConfig` callback (first callback inside `useLLMExtraction()`) with:

```typescript
  const getExtractionAgentConfig = useCallback(async () => {
    const store = useAgentStore.getState();
    if (!store.loaded) {
      await store.loadAgents().catch(() => {});
    }
    const agent = getExtractionAgent(useAgentStore.getState());
    const { instructions } = toPromptContext(agent);
    return { instructions, disallowedTools: agent.disallowedTools };
  }, []);
```

- [ ] **Step 2: Update all four call sites**

1. **`startExtraction`** (~line 235): replace `const { promptConfig } = await getAgentConfig();` with `const { instructions } = await getExtractionAgentConfig();` and the systemPrompt arg with `getQuickExtractSystemPrompt(notesOn, instructions, graphContext)`.
2. **`startQuickExtraction`** (~line 350; today calls NO config function and passes a hardcoded `undefined`): add `const { instructions } = await getExtractionAgentConfig();` beside the existing `notesOn`/`graphContext` fetches, and change `getQuickExtractSystemPrompt(notesOn, undefined, graphContext)` to `getQuickExtractSystemPrompt(notesOn, instructions, graphContext)`.
3. **`startAgentExtraction`** (~line 563): replace `const { promptConfig, toolConfig } = await getAgentConfig();` with `const { instructions, disallowedTools } = await getExtractionAgentConfig();`; in the `llm.runAgent` payload change `customInstructions: promptConfig?.extractionInstructions,` → `customInstructions: instructions,` and `disabledTools: toolConfig?.disabledExtractionTools,` → `disabledTools: disallowedTools,`.
4. **`startIngestion`** (~line 1135): replace `const { promptConfig } = await getAgentConfig();` with `const { instructions } = await getExtractionAgentConfig();` and the callback with `getSystemPrompt: (notesEnabled: boolean) => getQuickExtractSystemPrompt(notesEnabled, instructions, graphContext),`.

Sweep: `grep -n "getAgentConfig\|promptConfig\|toolConfig\|AGENT_PROMPT_CONFIG\|AGENT_TOOL_CONFIG" src/ui/hooks/useLLMExtraction.ts` → zero hits.

- [ ] **Step 3: Delete dead settings code**

```bash
git rm src/ui/components/settings/AgentSettingsTab.tsx
grep -rn "ToolToggleRow" src --include="*.tsx" --include="*.ts"
```
If `ToolToggleRow` now has zero importers, also `git rm src/ui/components/settings/ToolToggleRow.tsx`. (`agent-settings-types.ts` keys/types stay — `migrateFromLegacy()` uses them.)

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm test && npm run build:electron && npm run build`
Expected: all green (Chrome build compiles the offscreen agent loop — its `customInstructions` param plumbing is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/ui/hooks/useLLMExtraction.ts
git commit -m "fix(agents): extraction consumes the resolved agent's instructions and tool config

All four extraction modes (text, page, agent, ingestion) now read the
agent store via getExtractionAgent instead of the legacy agentPromptConfig
key that nothing has written since 0.3.0. Deletes the unmounted legacy
settings tab."
```
(the `git rm` deletions are already staged)

---

### Task 4: Settings → Agents page

**Files:**
- Create: `src/ui/components/settings/AgentAssignmentsTab.tsx`
- Modify: `src/ui/components/settings/SettingsModal.tsx` (type + TABS), `src/ui/components/settings/SettingsPanel.tsx` (render branch)

- [ ] **Step 1: Create the tab component** — `src/ui/components/settings/AgentAssignmentsTab.tsx`:

```tsx
import { useAgentStore } from '../../../graph/store/agent-store';
import type { AgentScope, CoreFeature } from '../../../shared/agent-definition-types';

const SCOPE_LABELS: Record<AgentScope, string> = {
  builtin: 'Built-in',
  user: 'Custom',
  vault: 'Vault',
};

function AgentSelect({
  label,
  helper,
  feature,
  kind,
}: {
  label: string;
  helper?: string;
  feature: CoreFeature;
  kind: 'chat' | 'extraction';
}) {
  const agents = useAgentStore((s) => s.agents);
  const featureAgents = useAgentStore((s) => s.featureAgents);
  const setFeatureAgent = useAgentStore((s) => s.setFeatureAgent);

  const options = agents.filter((a) => a.kind === kind && a.enabled);
  const value = featureAgents[feature] ?? '';

  return (
    <div>
      <label className="text-xs font-medium text-zinc-400 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => setFeatureAgent(feature, e.target.value || null)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
      >
        <option value="">(automatic)</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.icon} {a.name} — {SCOPE_LABELS[a.scope]}
          </option>
        ))}
      </select>
      {helper && <p className="text-[10px] text-zinc-500 mt-1">{helper}</p>}
    </div>
  );
}

export function AgentAssignmentsTab() {
  return (
    <div className="p-5 space-y-5">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Feature Agents</h3>
        <p className="text-xs text-zinc-500">
          Choose which agent each core feature uses. Create and configure agents in the
          Agents panel (left sidebar). “(automatic)” uses the built-in agent for that feature.
        </p>
        <AgentSelect
          label="Extraction agent"
          feature="extraction"
          kind="extraction"
          helper="Used by text extraction, page extraction, agent extraction, and file ingestion."
        />
        <AgentSelect
          label="Default chat agent"
          feature="chat"
          kind="chat"
          helper="The chat header picker can still switch agents per conversation; this sets the default."
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Register the tab**

`SettingsModal.tsx`:

```typescript
export type SettingsTab = 'general' | 'model' | 'agents' | 'billing' | 'about';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'agents', label: 'Agents' },
  { id: 'billing', label: 'Billing' },
  { id: 'about', label: 'About' },
];
```

`SettingsPanel.tsx`: add `import { AgentAssignmentsTab } from './AgentAssignmentsTab';` and, alongside the existing `if (activeTab === 'model')`-style branches, add:

```typescript
  if (activeTab === 'agents') {
    return <AgentAssignmentsTab />;
  }
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run build:electron && npm run build && npm test`
Expected: green.

- [ ] **Step 4: Commit**

```bash
git add src/ui/components/settings/AgentAssignmentsTab.tsx src/ui/components/settings/SettingsModal.tsx src/ui/components/settings/SettingsPanel.tsx
git commit -m "feat(settings): Agents page assigning extraction and default chat agents"
```

---

### Task 5: Extraction agents creatable from the Agents panel

**Files:**
- Modify: `src/ui/components/panels/AgentListView.tsx`

- [ ] **Step 1: Two-kind create affordance**

Replace the existing `handleCreate` and the single `+ New` button:

```tsx
  const handleCreate = async (kind: 'chat' | 'extraction') => {
    const newAgent = await duplicateAgent(kind === 'chat' ? 'chat' : 'extraction');
    onEditAgent(newAgent.id);
  };
```

```tsx
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleCreate('chat')}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-zinc-700"
          >
            + Chat
          </button>
          <button
            onClick={() => handleCreate('extraction')}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-zinc-700"
          >
            + Extraction
          </button>
        </div>
```

(`duplicateAgent('extraction')` copies the builtin extraction agent — `kind: 'extraction'` is preserved by the spread in the store's `duplicateAgent`.)

- [ ] **Step 2: Verify + commit**

Run: `npx tsc --noEmit && npm run build:electron && npm test`
Expected: green.

```bash
git add src/ui/components/panels/AgentListView.tsx
git commit -m "feat(agents): create custom extraction agents from the panel"
```

---

### Task 6: Docs, changelog, final gates

**Files:**
- Modify: `docs/agent-settings.md`, `CHANGELOG.md`

- [ ] **Step 1: Docs** — in `docs/agent-settings.md`, after the `## Chat Integration` section, add:

```markdown
## Feature Agent Assignment

Settings → Agents assigns which agent each core feature uses, persisted under the
`featureAgents` storage key (`{ extraction?: agentId, chat?: agentId }`).
Resolution is centralized: extraction resolves via `selectExtractionAgent(agents, featureAgents.extraction)`
(preference → enabled builtin → first enabled extraction agent → builtin default; never undefined),
and the chat assignment is the *default* — the chat header picker still switches per conversation.
Disabling or deleting an assigned agent falls back silently. New core features add a key to
`FeatureAgentMap` and a dropdown to `AgentAssignmentsTab`. Extraction consumes the resolved agent's
`customInstructions` (via `toPromptContext`) and `disallowedTools` in all four modes; the legacy
`agentPromptConfig`/`agentToolConfig` keys are no longer read outside the one-time migration.
```

In `CHANGELOG.md` under `## [Unreleased]` add:

```markdown
### Added
- Settings → Agents page: assign which agent extraction uses and the default chat agent (chat header picker still overrides per conversation)
- Custom extraction agents can be created from the Agents panel

### Fixed
- Agent custom instructions now actually reach extraction: all four extraction modes (text, page, agent, file ingestion) read the configured extraction agent instead of a legacy settings key that nothing had written since 0.3.0
```

(If `[Unreleased]` already has subsections, merge entries into them rather than duplicating headers.)

- [ ] **Step 2: Full gates**

Run: `npm test && npx tsc --noEmit && npm run build:electron && npm run build && npm run build:mcp`
Expected: all green (63 tests).

- [ ] **Step 3: Commit**

```bash
git add docs/agent-settings.md CHANGELOG.md
git commit -m "docs: feature agent assignment documentation and changelog"
```

- [ ] **Step 4: Manual smoke (controller/user)** — launch `npx electron .`; in the Agents panel set instructions on the extraction agent; run a text extraction; confirm the behavior reflects the instructions; open Settings → Agents and flip assignments.

---

## Self-review notes

- **Spec coverage:** §1 shared logic → Task 1; §2 store → Task 2; §3 repointing → Task 3; §4 settings page → Task 4; §5 creatable extraction agents → Task 5; §6 cleanup → Task 3; §7 tests → Task 1; §8 error handling → encoded in resolver/fallbacks (Tasks 1-2). Market-alignment section is design rationale (no code).
- **Type consistency:** `CoreFeature`/`FeatureAgentMap`/`FEATURE_AGENTS_KEY`/`toPromptContext`/`selectExtractionAgent` defined in Task 1, consumed with identical names in Tasks 2-4; `getExtractionAgentConfig` returns `{instructions, disallowedTools}` and Task 3's call sites destructure exactly those.
- **Known interim states:** none — each task compiles and passes gates independently (legacy key reads removed in the same task that introduces the replacement).
