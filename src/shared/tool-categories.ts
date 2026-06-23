export type ToolCategory = 'read' | 'write' | 'destructive';

export interface CategorizedTool {
  name: string;
  description: string;
  category: ToolCategory;
}

export interface ToolCategoryGroup {
  category: ToolCategory;
  label: string;
  tools: CategorizedTool[];
  variant?: 'destructive';
}

const DESTRUCTIVE_TOOLS = new Set([
  'delete_node', 'delete_nodes_batch', 'merge_nodes', 'delete_edge',
]);

export function categorizeToolDefs(
  tools: Array<{ name: string; description: string; category?: string }>,
): ToolCategoryGroup[] {
  const groups: Record<ToolCategory, CategorizedTool[]> = {
    read: [],
    write: [],
    destructive: [],
  };

  for (const tool of tools) {
    let cat: ToolCategory;
    if (DESTRUCTIVE_TOOLS.has(tool.name)) {
      cat = 'destructive';
    } else if (tool.category === 'write') {
      cat = 'write';
    } else if (tool.category === 'read') {
      cat = 'read';
    } else {
      cat = 'read';
    }
    groups[cat].push({ name: tool.name, description: tool.description, category: cat });
  }

  const result: ToolCategoryGroup[] = [];
  if (groups.read.length) result.push({ category: 'read', label: 'Read', tools: groups.read });
  if (groups.write.length) result.push({ category: 'write', label: 'Write', tools: groups.write });
  if (groups.destructive.length) result.push({ category: 'destructive', label: 'Destructive', tools: groups.destructive, variant: 'destructive' });
  return result;
}
