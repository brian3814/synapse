import { TOOL_CAPABILITY_MAP, getRequiredCapability } from './tools/types';
import type { Capability } from './tools/types';

export interface ProfileConfig {
  capabilities: Capability[];
  blocked_tools: string[];
  blocked_actions: string[];
}

const ACTION_TOOLS = new Map<string, string[]>([
  ['manage_entity', ['create', 'update', 'delete']],
  ['manage_relationship', ['create', 'update', 'delete']],
  ['manage_note', ['read', 'create', 'update']],
]);

export class ProfilePolicy {
  private caps: Set<Capability>;
  private blockedTools: Set<string>;
  private blockedActions: Set<string>;

  constructor(config: ProfileConfig) {
    this.caps = new Set(config.capabilities);
    this.blockedTools = new Set(config.blocked_tools);
    this.blockedActions = new Set(config.blocked_actions);
  }

  canExecute(tool: string, action?: string): boolean {
    if (this.blockedTools.has(tool)) return false;
    if (action && this.blockedActions.has(`${tool}:${action}`)) return false;
    const required = getRequiredCapability(tool, action);
    return this.caps.has(required);
  }

  canListTool(tool: string): boolean {
    if (this.blockedTools.has(tool)) return false;
    const actions = ACTION_TOOLS.get(tool);
    if (actions) {
      return actions.some((a) => this.canExecute(tool, a));
    }
    return this.canExecute(tool);
  }
}

export function loadProfileFromFile(configPath: string, profileName: string): ProfileConfig {
  try {
    const fs = require('fs');
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const profile = raw.profiles?.[profileName];
    if (profile) {
      return {
        capabilities: profile.capabilities ?? ['read'],
        blocked_tools: profile.blocked_tools ?? [],
        blocked_actions: profile.blocked_actions ?? [],
      };
    }
  } catch {}
  return { capabilities: ['read'], blocked_tools: [], blocked_actions: [] };
}
