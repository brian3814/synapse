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
    await this.disconnectServer(name);
    const resolved = resolveSecrets(config, this.secrets);
    if (resolved.transport === 'stdio') {
      await this.connectStdio(name, resolved);
    } else if (resolved.transport === 'http') {
      console.warn(`[MCP] HTTP transport for ${name} not yet implemented`);
    }
  }

  async disconnectServer(name: string): Promise<void> {
    const conn = this.connections.get(name);
    if (!conn) return;
    this.registry.removeProvider(conn.provider.id);
    try { await conn.client.close(); } catch {}
    try { await conn.transport.close(); } catch {}
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
        { capabilities: {} },
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
