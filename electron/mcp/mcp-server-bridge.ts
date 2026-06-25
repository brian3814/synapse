import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { IncomingMessage, ServerResponse } from 'http';
import type { IToolRegistry, McpServerExposedConfig, ToolFilter } from './types';
import type { KnowledgeService } from '../../src/mcp/knowledge-service';
import { ProfilePolicy, loadProfileFromFile } from '../../src/mcp/authorization';
import { createSynapseMcpServer } from '../../src/mcp/server';
import * as path from 'path';

export interface McpBridgeOptions {
  registry: IToolRegistry;
  config: McpServerExposedConfig;
  onGraphMutated?: (nodeIds?: string[], edgeIds?: string[]) => void;
  /** When set, MCP HTTP requests use the shared KnowledgeService path. */
  knowledgeService?: KnowledgeService;
  /** Vault path — needed to load profile config per request. */
  vaultPath?: string;
}

const WRITE_TOOL_NAMES = new Set([
  'create_node', 'update_node', 'create_edge',
  'delete_node', 'delete_nodes_batch', 'merge_nodes',
  'create_note', 'update_note',
  'update_edge', 'delete_edge',
  'add_alias', 'tag_node',
]);

export class McpServerBridge {
  private config: McpServerExposedConfig;
  private registry: IToolRegistry;
  private onGraphMutated?: (nodeIds?: string[], edgeIds?: string[]) => void;
  private knowledgeService?: KnowledgeService;
  private vaultPath?: string;

  constructor(opts: McpBridgeOptions) {
    this.registry = opts.registry;
    this.config = opts.config;
    this.onGraphMutated = opts.onGraphMutated;
    this.knowledgeService = opts.knowledgeService;
    this.vaultPath = opts.vaultPath;
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

  /**
   * Create a legacy Server backed by IToolRegistry (used when knowledgeService
   * is not configured, or as fallback).
   */
  private createLegacyServer(): Server {
    const server = new Server(
      { name: 'synapse', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => {
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

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
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

        if (!result.isError && WRITE_TOOL_NAMES.has(name)) {
          this.onGraphMutated?.(result.collectedNodeIds, result.collectedEdgeIds);
        }

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

    return server;
  }

  /**
   * Create a Server backed by the shared KnowledgeService.
   * Profile is loaded from disk per-request for dynamic reload.
   */
  private createKnowledgeServer(profileName: string): Server {
    const configPath = path.join(this.vaultPath!, '.synapse', 'mcp-server.json');
    const profileConfig = loadProfileFromFile(configPath, profileName);
    const policy = new ProfilePolicy(profileConfig);

    return createSynapseMcpServer(
      this.knowledgeService!,
      policy,
      (effects) => {
        this.onGraphMutated?.(effects.nodeIds, effects.edgeIds);
      },
    );
  }

  private createServer(req?: IncomingMessage): Server {
    // When knowledgeService is available, use the new shared path
    if (this.knowledgeService && this.vaultPath) {
      const profileName = req?.headers?.['x-synapse-profile'] as string | undefined;
      return this.createKnowledgeServer(profileName ?? 'default');
    }
    // Fallback to legacy registry-based server
    return this.createLegacyServer();
  }

  async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // SDK v1.29+ requires a fresh transport per request in stateless mode
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    const server = this.createServer(req);
    await server.connect(transport);
    try {
      await transport.handleRequest(req, res);
    } finally {
      await server.close().catch(() => {});
    }
  }

  async dispose(): Promise<void> {
    // no persistent state to clean up in per-request mode
  }
}
