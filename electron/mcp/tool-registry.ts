import { NAMESPACE_SEPARATOR } from './types';
import type { IToolRegistry, ToolProvider, ToolDefinition, ToolResult, ToolFilter } from './types';

export class ToolRegistry implements IToolRegistry {
  private providers = new Map<string, ToolProvider>();
  private listeners = new Set<() => void>();

  registerProvider(provider: ToolProvider): void {
    if (this.providers.has(provider.id)) {
      this.providers.get(provider.id)!.dispose();
    }
    this.providers.set(provider.id, provider);
    this.notifyChanged();
  }

  removeProvider(id: string): void {
    const provider = this.providers.get(id);
    if (provider) {
      provider.dispose();
      this.providers.delete(id);
      this.notifyChanged();
    }
  }

  getProviders(): ToolProvider[] {
    return [...this.providers.values()];
  }

  getAvailableTools(filter?: ToolFilter): ToolDefinition[] {
    const tools: ToolDefinition[] = [];

    for (const provider of this.providers.values()) {
      if (filter?.providerIds && !filter.providerIds.includes(provider.id)) continue;

      for (const tool of provider.listTools()) {
        const namespacedName = provider.namespace
          ? `${provider.namespace}${NAMESPACE_SEPARATOR}${tool.name}`
          : tool.name;

        if (filter?.disabledTools?.includes(namespacedName)) continue;
        if (filter?.capabilities && tool.category && !filter.capabilities.includes(tool.category)) continue;

        tools.push({
          ...tool,
          name: namespacedName,
        });
      }
    }

    return tools;
  }

  async executeTool(namespacedName: string, input: Record<string, unknown>): Promise<ToolResult> {
    const { providerId, toolName } = this.parseToolName(namespacedName);
    const provider = this.providers.get(providerId);

    if (!provider) {
      return { result: JSON.stringify({ error: `No provider found for tool: ${namespacedName}` }), isError: true };
    }

    return provider.executeTool(toolName, input);
  }

  onToolsChanged(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  dispose(): void {
    for (const provider of this.providers.values()) {
      provider.dispose();
    }
    this.providers.clear();
    this.listeners.clear();
  }

  private parseToolName(namespacedName: string): { providerId: string; toolName: string } {
    const sepIdx = namespacedName.indexOf(NAMESPACE_SEPARATOR);
    if (sepIdx === -1) {
      return { providerId: 'builtin', toolName: namespacedName };
    }
    const namespace = namespacedName.slice(0, sepIdx);
    const toolName = namespacedName.slice(sepIdx + NAMESPACE_SEPARATOR.length);
    return { providerId: `mcp:${namespace}`, toolName };
  }

  private notifyChanged(): void {
    for (const cb of this.listeners) {
      try { cb(); } catch {}
    }
  }
}
