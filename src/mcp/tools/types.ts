export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
  };
}

export type McpToolName =
  | 'search'
  | 'get_entity'
  | 'get_neighbors'
  | 'manage_entity'
  | 'manage_relationship'
  | 'merge_entities'
  | 'manage_note'
  | 'analyze_graph';

export type Capability = 'read' | 'write';

export const TOOL_CAPABILITY_MAP: Record<string, Capability> = {
  'search': 'read',
  'get_entity': 'read',
  'get_neighbors': 'read',
  'manage_entity:create': 'write',
  'manage_entity:update': 'write',
  'manage_entity:delete': 'write',
  'manage_relationship:create': 'write',
  'manage_relationship:update': 'write',
  'manage_relationship:delete': 'write',
  'merge_entities': 'write',
  'manage_note:read': 'read',
  'manage_note:create': 'write',
  'manage_note:update': 'write',
  'analyze_graph': 'read',
};

export function getRequiredCapability(tool: string, action?: string): Capability {
  const key = action ? `${tool}:${action}` : tool;
  return TOOL_CAPABILITY_MAP[key] ?? 'read';
}
