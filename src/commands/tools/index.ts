import type { ToolModule, ToolExecResult, CommandContext } from './types';
import type { ChatToolDefinition } from '../../shared/chat-agent-tools';
import { noteTools } from './note-tools';
import { edgeTools } from './edge-tools';
import { graphTools } from './graph-tools';
import { entityTools } from './entity-tools';

export type { ToolModule, ToolExecResult };

const ALL_MODULES: ToolModule[] = [noteTools, edgeTools, graphTools, entityTools];

export const EXTENDED_TOOL_DEFINITIONS: ChatToolDefinition[] =
  ALL_MODULES.flatMap((m) => m.definitions);

export async function executeExtendedTool(
  ctx: CommandContext,
  name: string,
  input: Record<string, unknown>,
): Promise<ToolExecResult | null> {
  for (const mod of ALL_MODULES) {
    const result = await mod.execute(ctx, name, input);
    if (result !== null) return result;
  }
  return null;
}
