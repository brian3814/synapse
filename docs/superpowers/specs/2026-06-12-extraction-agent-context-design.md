# Agent Context & Per-Feature Agent Assignment — Design

**Date:** 2026-06-12
**Status:** Approved
**Supersedes:** the narrower "extraction agent context seam" draft of the same date.

## Problem

1. **Bug:** Agent custom instructions have no effect on extraction. The Agents panel saves `AgentDefinition.customInstructions` to the agent store (`agentOverrides` storage key), but every extraction entry point in `useLLMExtraction.ts` reads the legacy `agentPromptConfig` key — unwritten since the 0.3.0 migration and absent from current profiles. One call site (`startQuickExtraction`) passes a hardcoded `undefined`. The prompt builders' injection mechanism (`## Custom Instructions` section) works; it is never fed.
2. **Gap:** There is no way to choose *which* agent a core feature uses. Chat has a header picker; extraction has nothing (and consumes no agent config at all).

## Goals

- Repoint extraction at the agent store through a seam that supports future per-agent context/instruction customization.
- Add per-feature agent assignment (extraction agent, default chat agent) via a Settings page.
- Keep the overall structure aligned with the mainstream custom-agent product shape (below).

## Market alignment

Mainstream custom-agent products (ChatGPT Custom GPTs, Gemini Gems, Claude Projects/Skills/Code subagents, Notion agents, M365 Copilot agents) converge on the same agent anatomy Synapse already has — instructions + tool allowlist + knowledge scope + enable toggle — and on three management patterns:

| Pattern | Mainstream examples | Synapse |
|---|---|---|
| Gallery + per-conversation picker | GPT sidebar/store, Gems picker, Claude Projects | Agents panel (ActivityBar) + chat header `AgentPicker` — **exists** |
| Feature/slot assignment (route a surface to an agent) | M365 Copilot agent assignment, Agentforce topic routing | Settings → Agents page with `featureAgents` map — **this design** |
| Files-as-config (version-controlled agent definitions) | Claude Code `.claude/agents/*.md`, Cursor modes, agent marketplaces | `.kg/agents/*.md` vault agents — **exists**, same frontmatter convention as Claude Code |

Agent collaboration in the market has three tiers: (1) human switches agents manually — the consumer default; (2) a primary agent auto-delegates to specialists routed by their *description* (Claude Code subagents, Copilot Studio orchestrator/connected agents) — the 2026 direction of travel; (3) explicit human-wired graphs (Copilot Studio canvas, Zapier/Lindy). **This design implements tier 1 surfaces plus slot assignment.** The resolver seam is deliberately the tier-2 entry point: a future "chat agent delegates to the configured extraction agent" feature routes through `selectExtractionAgent`/`featureAgents` without touching any consumer, and the `.md` agent format already carries the `description` field tier-2 routing needs.

## Decisions (with user)

- **Seam + assignment, no per-run picker for extraction.** Resolution is centralized; consumers never know how the agent was chosen.
- **Chat: default + override.** Settings assigns the *default* chat agent; the header picker still switches on the fly and persists the last choice. The default applies when the persisted active id is unset or invalid (deleted/disabled agent).
- **Full legacy cleanup.** Delete unmounted `AgentSettingsTab.tsx`; extraction stops reading `agentPromptConfig`/`agentToolConfig`. One-time `migrateFromLegacy()` stays.

## Design

### 1. Shared types & pure logic (`src/shared/agent-definition-types.ts`)

Platform-free (vitest-importable; `agent-store.ts` imports `@platform` and is not):

```ts
export type CoreFeature = 'extraction' | 'chat';
export interface FeatureAgentMap { extraction?: string; chat?: string; }
export const FEATURE_AGENTS_KEY = 'featureAgents';

export interface AgentPromptContext { instructions?: string; }
export function toPromptContext(agent: AgentDefinition): AgentPromptContext
// customInstructions, normalizing empty/whitespace-only to undefined.

export function selectExtractionAgent(agents: AgentDefinition[], preferredId?: string): AgentDefinition
```

`selectExtractionAgent` resolution order:
1. `preferredId` agent, if it exists, is `enabled`, and `kind === 'extraction'`;
2. the builtin `extraction` agent, if enabled;
3. the first enabled `kind === 'extraction'` agent in list order (vault agents merge into the list, so vault extraction agents are honored);
4. the builtin extraction default from `DEFAULT_AGENTS` — never returns `undefined`.

### 2. Agent store (`src/graph/store/agent-store.ts`)

- New state: `featureAgents: FeatureAgentMap` (default `{}`), loaded in `loadAgents()`'s existing `storage.get` batch.
- New action: `setFeatureAgent(feature: CoreFeature, agentId: string | null): Promise<void>` — updates state and persists the map under `FEATURE_AGENTS_KEY` (null deletes the entry).
- New selector (thin, following the `getActiveAgent` pattern):
  ```ts
  export function getExtractionAgent(state: AgentStore): AgentDefinition {
    return selectExtractionAgent(state.agents, state.featureAgents.extraction);
  }
  ```
- Chat default chain: `loadAgents()` resolves the initial active id as `storedActiveId || featureAgents.chat || 'chat'`, and `getActiveAgent` falls back `activeAgentId → featureAgents.chat → 'chat' → agents[0]`, skipping entries that don't resolve to an existing enabled chat-kind agent. The header picker's `setActiveAgent` behavior is unchanged.

### 3. Extraction repointing (`src/ui/hooks/useLLMExtraction.ts`)

Replace `getAgentConfig()` (legacy storage reads) with `getExtractionAgentConfig()`:
- `await useAgentStore.getState().loadAgents()` if `!loaded` (store self-initializes at module load; this guards races and failures);
- resolve via `getExtractionAgent`, derive via `toPromptContext`;
- return `{ instructions, disallowedTools }` (from the agent definition).

| Site | Change |
|---|---|
| `startExtraction` (~:242) | `getQuickExtractSystemPrompt(notesOn, instructions, graphContext)` |
| `startQuickExtraction` (~:363) | same — fixes the hardcoded `undefined` |
| `startAgentExtraction` (~:581) | `customInstructions: instructions`, `disabledTools: disallowedTools` |
| `startIngestion` (~:1160) | `getSystemPrompt` callback uses `instructions` |

Prompt builders (`quick-extract-prompt.ts`, `system-prompts.ts`) keep their `customInstructions?: string` parameters — no churn in shared prompts or the Chrome offscreen agent loop.

### 4. Settings → Agents page

- `SettingsModal.tsx`: `SettingsTab` union gains `'agents'`; `TABS` gains `{ id: 'agents', label: 'Agents' }`; `SettingsPanel` renders the new component for it.
- New `src/ui/components/settings/AgentAssignmentsTab.tsx`: one labeled select per core feature —
  - **Extraction agent**: options = enabled agents with `kind === 'extraction'`;
  - **Default chat agent**: options = enabled agents with `kind === 'chat'`, plus helper text "The chat header picker can switch agents per conversation; this sets the default.";
  - options show icon, name, and a scope badge (builtin/user/vault); selection calls `setFeatureAgent`; current value from store state, with "(automatic)" as the unset option (falls back to the resolution rule).
- Assignment only — agent *editing* stays in the Agents panel (the 0.3.0-removed editing tab is not resurrected).

### 5. Custom extraction agents become creatable

`AgentListView`'s new-agent action currently calls `duplicateAgent('chat')` only. It becomes a two-option affordance ("New chat agent" / "New extraction agent") calling `duplicateAgent('chat' | 'extraction')` — duplicating the builtin extraction agent yields a `kind: 'extraction'` user agent. `AgentDetailView` already works for any agent (tool list comes from the full registry via `tools:list`; no kind filtering in v1).

### 6. Cleanup

- Delete `src/ui/components/settings/AgentSettingsTab.tsx` (unmounted since 0.3.0; sole writer of the legacy key).
- Remove `AGENT_PROMPT_CONFIG_KEY`/`AGENT_TOOL_CONFIG_KEY` imports and reads from `useLLMExtraction.ts`.
- Keys/types remain in `agent-settings-types.ts` (still used by `migrateFromLegacy()`).

### 7. Testing

New `tests/agents/extraction-agent.test.ts` (vitest; imports only from `src/shared/` — no zustand, no `@platform`):

- `selectExtractionAgent`: no preference → builtin; preference valid → preferred; preference disabled → fallback; preference wrong kind (chat id) → fallback; builtin disabled + enabled vault extraction agent → vault agent; everything disabled → builtin default fallback.
- `toPromptContext`: pass-through; empty/whitespace → `undefined`.
- Regression test for the bug class: `getQuickExtractSystemPrompt(false, instructions)` emits a `## Custom Instructions` block containing the text; with `undefined` it emits none.

Store/UI wiring is verified by typecheck + builds + manual smoke (set instructions on the extraction agent, run a text extraction, observe compliance/prompt).

### 8. Error handling

- Resolver never returns `undefined`; disabling or deleting an assigned agent silently falls back to the rule — features never break from agent management actions.
- `loadAgents()` failure leaves `DEFAULT_AGENTS` and `{}` featureAgents → extraction degrades to no-custom-instructions (today's behavior, now only on genuine failure).
- A `featureAgents` entry referencing a vanished vault agent (vault switched) falls back the same way.

## Out of scope / future directions

- Tier-2 delegation: chat agent invoking the configured extraction agent (routes through this seam when built).
- Enforcing `guardrails`/`graphScope`/`skills`/`hooks` (declared on `AgentDefinition`, consumed by nothing today).
- Kind-filtered tool lists in `AgentDetailView`.
- Additional core-feature slots (e.g. ingestion-specific agent) — new keys in `FeatureAgentMap`, new dropdowns on the same page.
