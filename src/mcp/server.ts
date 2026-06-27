/**
 * Shared MCP server factory.
 *
 * Creates an MCP SDK `Server` wired to the KnowledgeService via
 * executeToolHandler, with ProfilePolicy-based tool filtering.
 *
 * Used by both the Electron main process (McpServerBridge) and the
 * standalone CLI (packages/synapse-mcp).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import type { KnowledgeService } from './knowledge-service';
import type { ProfilePolicy } from './authorization';
import { MCP_TOOL_DEFINITIONS } from './tools/definitions';
import { executeToolHandler } from './tools/handlers';

export function createSynapseMcpServer(
  service: KnowledgeService,
  policy: ProfilePolicy,
  onMutation?: (effects: { nodeIds: string[]; edgeIds: string[] }) => void,
): Server {
  const server = new Server(
    { name: 'synapse', version: '0.7.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: MCP_TOOL_DEFINITIONS
      .filter((t) => policy.canListTool(t.name))
      .map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as any,
      })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const result = await executeToolHandler(
      service,
      policy,
      name,
      (args ?? {}) as Record<string, unknown>,
    );

    if (
      !result.isError &&
      (result.effects.nodeIds.length > 0 || result.effects.edgeIds.length > 0)
    ) {
      onMutation?.(result.effects);
    }

    return {
      content: [{ type: 'text' as const, text: result.result }],
      isError: result.isError,
    };
  });

  return server;
}
