import type { CommandContext } from '../types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';

export type { CommandContext };

export interface ToolExecResult {
  result: string;
  collectedNodeIds?: string[];
  collectedEdgeIds?: string[];
}

export interface ToolModule {
  definitions: ChatToolDefinition[];
  execute(ctx: CommandContext, name: string, input: Record<string, unknown>): Promise<ToolExecResult | null>;
}
