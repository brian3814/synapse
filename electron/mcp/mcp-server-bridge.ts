import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IToolRegistry, McpServerExposedConfig, ToolFilter } from './types';

export class McpServerBridge {
  private mcpServer: McpServer;
  private transport: StreamableHTTPServerTransport | null = null;
  private config: McpServerExposedConfig;
  private registry: IToolRegistry;

  constructor(registry: IToolRegistry, config: McpServerExposedConfig) {
    this.registry = registry;
    this.config = config;
    this.mcpServer = new McpServer({ name: 'synapse', version: '1.0.0' });
    this.registerHandlers();
  }

  private getFilter(): ToolFilter {
    const defaultProfile = this.config.profiles['default'] ?? {
      name: 'default',
      capabilities: ['read'],
      blockedTools: [],
    };

    return {
      providerIds: ['builtin'],
      capabilities: defaultProfile.capabilities as ('read' | 'write' | 'execute')[],
      disabledTools: [
        ...(defaultProfile.blockedTools ?? []),
        'manage_memory',
      ],
    };
  }

  private registerHandlers(): void {
    const lowLevel = this.mcpServer.server;

    // tools/list — return available tools with JSON Schema input schemas
    lowLevel.setRequestHandler(ListToolsRequestSchema, async () => {
      const filter = this.getFilter();
      const tools = this.registry.getAvailableTools(filter);
      return {
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.parameters as any,
        })),
      };
    });

    // tools/call — execute a tool and return result
    lowLevel.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const filter = this.getFilter();
      const available = this.registry.getAvailableTools(filter);
      const found = available.find((t) => t.name === name);

      if (!found) {
        return {
          content: [{ type: 'text' as const, text: `Tool not found or not permitted: ${name}` }],
          isError: true,
        };
      }

      try {
        const result = await this.registry.executeTool(name, (args ?? {}) as Record<string, unknown>);
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
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.transport) {
      this.transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await this.mcpServer.connect(this.transport);
    }
    await this.transport.handleRequest(req, res);
  }

  async dispose(): Promise<void> {
    try { await this.mcpServer.close(); } catch {}
    this.transport = null;
  }
}
