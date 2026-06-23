import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from './types';

export class McpToolProvider implements ToolProvider {
  readonly id: string;
  readonly namespace: string;
  private tools: ToolDefinition[] = [];
  private disabledTools: Set<string>;

  constructor(
    serverName: string,
    private client: Client,
    disabledTools?: string[],
  ) {
    this.id = `mcp:${serverName}`;
    this.namespace = serverName;
    this.disabledTools = new Set(disabledTools ?? []);
  }

  async discoverTools(): Promise<void> {
    const response = await this.client.listTools();
    this.tools = response.tools.map((t) => ({
      name: t.name,
      description: t.description ?? '',
      parameters: t.inputSchema as Record<string, unknown>,
    }));
  }

  listTools(): ToolDefinition[] {
    return this.tools.filter((t) => !this.disabledTools.has(t.name));
  }

  async executeTool(name: string, input: Record<string, unknown>): Promise<ToolResult> {
    try {
      const response = await this.client.callTool({ name, arguments: input });
      const content = response.content as Array<{ type: string; text?: string }>;
      const textContent = content
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
        .join('\n');

      return {
        result: textContent || JSON.stringify(content),
        isError: (response.isError as boolean) ?? false,
      };
    } catch (e: any) {
      return { result: JSON.stringify({ error: e.message }), isError: true };
    }
  }

  dispose(): void {}
}
