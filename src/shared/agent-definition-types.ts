export interface AgentToolFilter {
  disabledTools?: string[];
  allowedTools?: string[];
  providerIds?: string[];
  capabilities?: ('read' | 'write' | 'execute')[];
}

export type AgentKind = 'chat' | 'extraction';
export type AgentScope = 'builtin' | 'user' | 'vault';

export interface GuardrailRule {
  match: string;
  action: 'allow' | 'deny' | 'confirm';
  reason?: string;
}

export interface AgentGuardrails {
  rules?: GuardrailRule[];
  maxBatchSize?: number;
  confirmWrites?: boolean;
  confirmDestructive?: boolean;
}

export interface AgentGraphScope {
  allowedNodeTypes?: string[];
  deniedNodeTypes?: string[];
  requiredTags?: string[];
  excludedTags?: string[];
  maxTraversalDepth?: number;
  readOnly?: boolean;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  icon: string;
  kind: AgentKind;
  scope: AgentScope;
  enabled: boolean;

  customInstructions: string;
  conversationStarters: string[];

  tools?: string[];
  disallowedTools?: string[];
  mcpServers?: string[];

  guardrails?: AgentGuardrails;
  graphScope?: AgentGraphScope;
  skills?: string[];
  hooks?: Record<string, string>;

  maxIterations: number;

  createdAt: number;
  updatedAt: number;
}

export const AGENT_OVERRIDES_KEY = 'agentOverrides';
export const ACTIVE_AGENT_KEY = 'activeAgentId';

export const DEFAULT_AGENTS: AgentDefinition[] = [
  {
    id: 'chat',
    name: 'chat-agent',
    description: 'General-purpose knowledge graph assistant',
    icon: '💬',
    kind: 'chat',
    scope: 'builtin',
    enabled: true,
    customInstructions: '',
    conversationStarters: [],
    maxIterations: 100,
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'extraction',
    name: 'extraction-agent',
    description: 'Extracts entities and relationships from content',
    icon: '✨',
    kind: 'extraction',
    scope: 'builtin',
    enabled: true,
    customInstructions: '',
    conversationStarters: [],
    maxIterations: 15,
    createdAt: 0,
    updatedAt: 0,
  },
];

export function toToolFilter(agent: AgentDefinition): AgentToolFilter {
  const filter: AgentToolFilter = {};

  if (agent.disallowedTools?.length) {
    filter.disabledTools = agent.disallowedTools;
  }

  if (agent.tools?.length) {
    filter.allowedTools = agent.tools;
  }

  if (agent.mcpServers) {
    if (agent.mcpServers.length === 0) {
      filter.providerIds = ['builtin'];
    } else {
      filter.providerIds = ['builtin', ...agent.mcpServers.map(s => `mcp:${s}`)];
    }
  }

  if (agent.graphScope?.readOnly) {
    filter.capabilities = ['read'];
  }

  return filter;
}

// --- Frontmatter Parser ---

interface ParsedAgentFile {
  frontmatter: Record<string, unknown>;
  body: string;
}

function parseFrontmatter(content: string): ParsedAgentFile {
  const trimmed = content.trim();
  if (!trimmed.startsWith('---')) {
    return { frontmatter: {}, body: trimmed };
  }

  const endIdx = trimmed.indexOf('---', 3);
  if (endIdx === -1) {
    return { frontmatter: {}, body: trimmed };
  }

  const yamlBlock = trimmed.slice(3, endIdx).trim();
  const body = trimmed.slice(endIdx + 3).trim();

  const frontmatter: Record<string, unknown> = {};
  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of yamlBlock.split('\n')) {
    const trimLine = line.trim();
    if (!trimLine || trimLine.startsWith('#')) continue;

    if (trimLine.startsWith('- ') && currentKey && currentList) {
      currentList.push(trimLine.slice(2).trim().replace(/^["']|["']$/g, ''));
      frontmatter[currentKey] = currentList;
      continue;
    }

    if (currentList) {
      currentList = null;
      currentKey = null;
    }

    const colonIdx = trimLine.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimLine.slice(0, colonIdx).trim();
    const rawValue = trimLine.slice(colonIdx + 1).trim();

    if (!rawValue) {
      currentKey = key;
      currentList = [];
      frontmatter[key] = currentList;
      continue;
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      frontmatter[key] = rawValue.slice(1, -1).split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else if (rawValue === 'true') {
      frontmatter[key] = true;
    } else if (rawValue === 'false') {
      frontmatter[key] = false;
    } else if (/^\d+$/.test(rawValue)) {
      frontmatter[key] = parseInt(rawValue, 10);
    } else {
      frontmatter[key] = rawValue.replace(/^["']|["']$/g, '');
    }
  }

  return { frontmatter, body };
}

export function parseAgentFile(content: string, filePath: string, scope: AgentScope): AgentDefinition {
  const { frontmatter: fm, body } = parseFrontmatter(content);
  const name = (fm.name as string) || filePath.split('/').pop()?.replace('.md', '') || 'unnamed';
  const now = Date.now();

  return {
    id: `${scope}:${name}`,
    name,
    description: (fm.description as string) || '',
    icon: (fm.icon as string) || '🤖',
    kind: (fm.kind as AgentKind) || 'chat',
    scope,
    enabled: fm.enabled !== false,
    customInstructions: body,
    conversationStarters: Array.isArray(fm.conversationStarters) ? fm.conversationStarters as string[] : [],
    tools: Array.isArray(fm.tools) ? fm.tools as string[] : undefined,
    disallowedTools: Array.isArray(fm.disallowedTools) ? fm.disallowedTools as string[] : undefined,
    mcpServers: Array.isArray(fm.mcpServers) ? fm.mcpServers as string[] : undefined,
    guardrails: fm.guardrails as AgentGuardrails | undefined,
    graphScope: fm.graphScope as AgentGraphScope | undefined,
    skills: Array.isArray(fm.skills) ? fm.skills as string[] : undefined,
    hooks: (fm.hooks && typeof fm.hooks === 'object') ? fm.hooks as Record<string, string> : undefined,
    maxIterations: typeof fm.maxIterations === 'number' ? fm.maxIterations : 100,
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeAgentToMd(agent: AgentDefinition): string {
  const lines: string[] = ['---'];

  lines.push(`name: ${agent.name}`);
  lines.push(`description: ${agent.description}`);
  if (agent.icon && agent.icon !== '🤖') lines.push(`icon: "${agent.icon}"`);
  if (agent.kind !== 'chat') lines.push(`kind: ${agent.kind}`);
  if (!agent.enabled) lines.push(`enabled: false`);

  if (agent.tools?.length) {
    lines.push('tools:');
    for (const t of agent.tools) lines.push(`  - ${t}`);
  }
  if (agent.disallowedTools?.length) {
    lines.push('disallowedTools:');
    for (const t of agent.disallowedTools) lines.push(`  - ${t}`);
  }
  if (agent.mcpServers) {
    lines.push('mcpServers:');
    for (const s of agent.mcpServers) lines.push(`  - ${s}`);
  }

  if (agent.maxIterations !== 100) lines.push(`maxIterations: ${agent.maxIterations}`);

  if (agent.conversationStarters?.length) {
    lines.push('conversationStarters:');
    for (const s of agent.conversationStarters) lines.push(`  - "${s}"`);
  }

  lines.push('---');
  if (agent.customInstructions) {
    lines.push('');
    lines.push(agent.customInstructions);
  }

  return lines.join('\n');
}
