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
