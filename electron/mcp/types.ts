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
  allowedTools?: string[];
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
