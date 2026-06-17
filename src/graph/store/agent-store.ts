import { create } from 'zustand';
import { storage, platformId, vaultWorkspace } from '@platform';
import {
  type AgentDefinition,
  type AgentToolFilter,
  type FeatureAgentMap,
  type CoreFeature,
  DEFAULT_AGENTS,
  AGENT_OVERRIDES_KEY,
  ACTIVE_AGENT_KEY,
  FEATURE_AGENTS_KEY,
  selectExtractionAgent,
  toToolFilter,
} from '../../shared/agent-definition-types';

interface AgentOverrides {
  agents: Partial<AgentDefinition>[];
  migrated?: boolean;
}

interface AgentStore {
  agents: AgentDefinition[];
  activeAgentId: string;
  loaded: boolean;
  featureAgents: FeatureAgentMap;

  loadAgents: () => Promise<void>;
  setActiveAgent: (id: string) => void;
  setFeatureAgent: (feature: CoreFeature, agentId: string | null) => Promise<void>;
  saveAgent: (agent: AgentDefinition) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  duplicateAgent: (id: string) => Promise<AgentDefinition>;
  resetBuiltinAgent: (id: string) => Promise<void>;
  toggleAgentEnabled: (id: string) => Promise<void>;
}

function getActiveAgent(state: AgentStore): AgentDefinition {
  const resolve = (id?: string) =>
    id ? state.agents.find(a => a.id === id && a.enabled && a.kind === 'chat') : undefined;
  return resolve(state.activeAgentId)
    ?? resolve(state.featureAgents.chat)
    ?? state.agents.find(a => a.id === 'chat')
    ?? state.agents[0];
}

function getActiveToolFilter(state: AgentStore): AgentToolFilter {
  return toToolFilter(getActiveAgent(state));
}

function getExtractionAgent(state: AgentStore): AgentDefinition {
  return selectExtractionAgent(state.agents, state.featureAgents.extraction);
}

function getEnabledChatAgents(state: AgentStore): AgentDefinition[] {
  return state.agents.filter(a => a.kind === 'chat' && a.enabled);
}

async function migrateFromLegacy(): Promise<AgentOverrides> {
  const data = await storage.get([
    'agentPromptConfig', 'agentToolConfig', 'harnessPresets', 'harnessActivePresetId',
  ]).catch(() => ({} as Record<string, any>));

  const overrides: AgentOverrides = { agents: [], migrated: true };
  const promptConfig = data.agentPromptConfig as { chatInstructions?: string; extractionInstructions?: string } | undefined;
  const toolConfig = data.agentToolConfig as { disabledChatTools?: string[]; disabledExtractionTools?: string[]; chatMaxIterations?: number } | undefined;

  if (promptConfig?.chatInstructions || toolConfig?.disabledChatTools?.length || toolConfig?.chatMaxIterations) {
    overrides.agents.push({
      id: 'chat',
      customInstructions: promptConfig?.chatInstructions || '',
      disallowedTools: toolConfig?.disabledChatTools,
      maxIterations: toolConfig?.chatMaxIterations,
    });
  }

  if (promptConfig?.extractionInstructions || toolConfig?.disabledExtractionTools?.length) {
    overrides.agents.push({
      id: 'extraction',
      customInstructions: promptConfig?.extractionInstructions || '',
      disallowedTools: toolConfig?.disabledExtractionTools,
    });
  }

  const presets = data.harnessPresets as Array<{ id: string; name: string; prompt: string; createdAt: number }> | undefined;
  if (presets?.length) {
    for (const preset of presets) {
      overrides.agents.push({
        id: `user:${preset.name.toLowerCase().replace(/\s+/g, '-')}`,
        name: preset.name.toLowerCase().replace(/\s+/g, '-'),
        description: `Migrated from preset: ${preset.name}`,
        icon: '📝',
        kind: 'chat',
        scope: 'user',
        enabled: true,
        customInstructions: preset.prompt,
        conversationStarters: [],
        maxIterations: 100,
        createdAt: preset.createdAt,
        updatedAt: preset.createdAt,
      } as AgentDefinition);
    }
  }

  return overrides;
}

async function loadVaultAgents(): Promise<AgentDefinition[]> {
  if (platformId !== 'electron') return [];
  try {
    const agents: AgentDefinition[] = await (window as any).electronIPC.invoke('agents:list-vault').catch(() => []);
    return agents;
  } catch {
    return [];
  }
}

function mergeAgents(defaults: AgentDefinition[], overrides: AgentOverrides, vaultAgents: AgentDefinition[]): AgentDefinition[] {
  const result = defaults.map(def => {
    const override = overrides.agents.find(o => o.id === def.id);
    if (!override) return def;
    return { ...def, ...override, scope: def.scope } as AgentDefinition;
  });

  for (const override of overrides.agents) {
    if (defaults.some(d => d.id === override.id)) continue;
    if (override.name && override.scope) {
      result.push(override as AgentDefinition);
    }
  }

  for (const va of vaultAgents) {
    if (!result.some(a => a.id === va.id)) {
      result.push(va);
    }
  }

  return result;
}

async function persistOverrides(agents: AgentDefinition[]): Promise<void> {
  const overrideData: Partial<AgentDefinition>[] = [];

  for (const agent of agents) {
    if (agent.scope === 'vault') continue;

    if (agent.scope === 'builtin') {
      const def = DEFAULT_AGENTS.find(d => d.id === agent.id);
      if (!def) continue;
      const diff: Partial<AgentDefinition> = { id: agent.id };
      let hasDiff = false;
      if (agent.customInstructions !== def.customInstructions) { diff.customInstructions = agent.customInstructions; hasDiff = true; }
      if (agent.maxIterations !== def.maxIterations) { diff.maxIterations = agent.maxIterations; hasDiff = true; }
      if (agent.enabled !== def.enabled) { diff.enabled = agent.enabled; hasDiff = true; }
      if (agent.disallowedTools?.length) { diff.disallowedTools = agent.disallowedTools; hasDiff = true; }
      if (agent.tools?.length) { diff.tools = agent.tools; hasDiff = true; }
      if (agent.mcpServers) { diff.mcpServers = agent.mcpServers; hasDiff = true; }
      if (agent.conversationStarters?.length) { diff.conversationStarters = agent.conversationStarters; hasDiff = true; }
      if (hasDiff) overrideData.push(diff);
    } else {
      overrideData.push(agent);
    }
  }

  await storage.set({ [AGENT_OVERRIDES_KEY]: { agents: overrideData, migrated: true } }).catch(() => {});
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  agents: [...DEFAULT_AGENTS],
  activeAgentId: 'chat',
  loaded: false,
  featureAgents: {},

  loadAgents: async () => {
    let overrides: AgentOverrides;
    const raw = await storage.get([AGENT_OVERRIDES_KEY, ACTIVE_AGENT_KEY, FEATURE_AGENTS_KEY]).catch(() => ({} as Record<string, any>));
    const stored = raw[AGENT_OVERRIDES_KEY] as AgentOverrides | undefined;

    if (stored?.migrated) {
      overrides = stored;
    } else {
      overrides = await migrateFromLegacy();
      await storage.set({ [AGENT_OVERRIDES_KEY]: overrides }).catch(() => {});
    }

    const vaultAgents = await loadVaultAgents();
    const agents = mergeAgents([...DEFAULT_AGENTS], overrides, vaultAgents);
    const featureAgents = (raw[FEATURE_AGENTS_KEY] as FeatureAgentMap) || {};
    // The stored id may be stale (deleted/disabled agent); getActiveAgent
    // validates lazily — don't trust state.activeAgentId raw.
    const activeId = (raw[ACTIVE_AGENT_KEY] as string) || featureAgents.chat || 'chat';

    set({ agents, activeAgentId: activeId, featureAgents, loaded: true });
  },

  setActiveAgent: (id) => {
    set({ activeAgentId: id });
    storage.set({ [ACTIVE_AGENT_KEY]: id }).catch(() => {});
  },

  setFeatureAgent: async (feature, agentId) => {
    const next = { ...get().featureAgents };
    if (agentId) next[feature] = agentId;
    else delete next[feature];
    set({ featureAgents: next });
    await storage.set({ [FEATURE_AGENTS_KEY]: next }).catch(() => {});
  },

  saveAgent: async (agent) => {
    set(state => ({
      agents: state.agents.map(a => a.id === agent.id ? { ...agent, updatedAt: Date.now() } : a),
    }));
    await persistOverrides(get().agents);
  },

  deleteAgent: async (id) => {
    const agent = get().agents.find(a => a.id === id);
    if (!agent || agent.scope === 'builtin') return;

    set(state => ({
      agents: state.agents.filter(a => a.id !== id),
      activeAgentId: state.activeAgentId === id ? 'chat' : state.activeAgentId,
    }));

    if (agent.scope === 'vault') {
      try {
        const status = await vaultWorkspace.getStatus();
        if (status.open && status.path) {
          const filePath = `${status.path}/.synapse/agents/${agent.name}.md`;
          await (window as any).electronIPC.invoke('vault-explorer:delete-files', [filePath]);
        }
      } catch {}
    }

    await persistOverrides(get().agents);
  },

  duplicateAgent: async (sourceId) => {
    const source = get().agents.find(a => a.id === sourceId);
    if (!source) throw new Error('Agent not found');

    const now = Date.now();
    const newAgent: AgentDefinition = {
      ...source,
      id: `user:${source.name}-copy-${now}`,
      name: `${source.name}-copy`,
      scope: 'user',
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    set(state => ({ agents: [...state.agents, newAgent] }));
    await persistOverrides(get().agents);
    return newAgent;
  },

  resetBuiltinAgent: async (id) => {
    const def = DEFAULT_AGENTS.find(d => d.id === id);
    if (!def) return;

    set(state => ({
      agents: state.agents.map(a => a.id === id ? { ...def } : a),
    }));
    await persistOverrides(get().agents);
  },

  toggleAgentEnabled: async (id) => {
    set(state => ({
      agents: state.agents.map(a => a.id === id ? { ...a, enabled: !a.enabled } : a),
    }));
    await persistOverrides(get().agents);
  },
}));

// Eagerly load agents on store creation so subscribers don't trigger async loads during render
useAgentStore.getState().loadAgents().catch(() => {});

export { getActiveAgent, getActiveToolFilter, getExtractionAgent, getEnabledChatAgents };
