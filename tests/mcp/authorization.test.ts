import { describe, it, expect } from 'vitest';
import { ProfilePolicy } from '../../src/mcp/authorization';

describe('ProfilePolicy', () => {
  it('readonly profile allows read tools', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('search')).toBe(true);
    expect(policy.canExecute('get_entity')).toBe(true);
    expect(policy.canExecute('analyze_graph')).toBe(true);
  });

  it('readonly profile blocks write tools', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_entity', 'create')).toBe(false);
    expect(policy.canExecute('merge_entities')).toBe(false);
  });

  it('readonly profile allows manage_note:read but blocks create/update', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_note', 'read')).toBe(true);
    expect(policy.canExecute('manage_note', 'create')).toBe(false);
  });

  it('write profile allows all actions', () => {
    const policy = new ProfilePolicy({ capabilities: ['read', 'write'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canExecute('manage_entity', 'delete')).toBe(true);
    expect(policy.canExecute('manage_note', 'create')).toBe(true);
  });

  it('blocked_actions overrides capability', () => {
    const policy = new ProfilePolicy({
      capabilities: ['read', 'write'],
      blocked_tools: [],
      blocked_actions: ['manage_entity:delete'],
    });
    expect(policy.canExecute('manage_entity', 'create')).toBe(true);
    expect(policy.canExecute('manage_entity', 'delete')).toBe(false);
  });

  it('blocked_tools blocks entire tool', () => {
    const policy = new ProfilePolicy({
      capabilities: ['read', 'write'],
      blocked_tools: ['merge_entities'],
      blocked_actions: [],
    });
    expect(policy.canExecute('merge_entities')).toBe(false);
  });

  it('canListTool returns true if ANY action is allowed', () => {
    const policy = new ProfilePolicy({ capabilities: ['read'], blocked_tools: [], blocked_actions: [] });
    expect(policy.canListTool('manage_note')).toBe(true);
    expect(policy.canListTool('manage_entity')).toBe(false);
    expect(policy.canListTool('search')).toBe(true);
  });
});
