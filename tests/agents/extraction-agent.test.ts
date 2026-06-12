import { describe, it, expect } from 'vitest';
import {
  DEFAULT_AGENTS,
  selectExtractionAgent,
  toPromptContext,
  type AgentDefinition,
} from '../../src/shared/agent-definition-types';
import { getQuickExtractSystemPrompt } from '../../src/shared/quick-extract-prompt';

function makeAgent(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    id: 'x',
    name: 'x',
    description: '',
    icon: '🤖',
    kind: 'extraction',
    scope: 'user',
    enabled: true,
    customInstructions: '',
    conversationStarters: [],
    maxIterations: 15,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

const builtinChat = DEFAULT_AGENTS.find(a => a.id === 'chat')!;
const builtinExtraction = DEFAULT_AGENTS.find(a => a.id === 'extraction')!;

describe('selectExtractionAgent', () => {
  it('returns the builtin extraction agent when no preference is set', () => {
    const agents = [builtinChat, builtinExtraction];
    expect(selectExtractionAgent(agents).id).toBe('extraction');
  });

  it('honors a valid preferred agent', () => {
    const custom = makeAgent({ id: 'user:my-extractor', name: 'my-extractor' });
    const agents = [builtinChat, builtinExtraction, custom];
    expect(selectExtractionAgent(agents, 'user:my-extractor').id).toBe('user:my-extractor');
  });

  it('falls back to the builtin when the preferred agent is disabled', () => {
    const custom = makeAgent({ id: 'user:my-extractor', enabled: false });
    const agents = [builtinChat, builtinExtraction, custom];
    expect(selectExtractionAgent(agents, 'user:my-extractor').id).toBe('extraction');
  });

  it('falls back when the preferred id points at a chat agent', () => {
    const agents = [builtinChat, builtinExtraction];
    expect(selectExtractionAgent(agents, 'chat').id).toBe('extraction');
  });

  it('uses the first enabled extraction agent when the builtin is disabled', () => {
    const disabledBuiltin = { ...builtinExtraction, enabled: false };
    const vaultAgent = makeAgent({ id: 'vault:my-extractor', scope: 'vault' });
    const agents = [builtinChat, disabledBuiltin, vaultAgent];
    expect(selectExtractionAgent(agents).id).toBe('vault:my-extractor');
  });

  it('falls back to the builtin default when every extraction agent is disabled', () => {
    const disabledBuiltin = { ...builtinExtraction, enabled: false };
    const agents = [builtinChat, disabledBuiltin];
    const resolved = selectExtractionAgent(agents);
    expect(resolved.id).toBe('extraction');
    expect(resolved.enabled).toBe(true); // the pristine DEFAULT_AGENTS entry
  });

  it('falls back when the preferred id matches no agent at all (vanished vault agent)', () => {
    const agents = [builtinChat, builtinExtraction];
    expect(selectExtractionAgent(agents, 'vault:gone-after-vault-switch').id).toBe('extraction');
  });

  it('returns the pristine default without exposing it to caller mutation surprises', () => {
    const disabledBuiltin = { ...builtinExtraction, enabled: false };
    const first = selectExtractionAgent([builtinChat, disabledBuiltin]);
    const second = selectExtractionAgent([builtinChat, disabledBuiltin]);
    // Documents current behavior: the fallback aliases the module-level
    // DEFAULT_AGENTS entry, so callers must treat resolved agents as read-only.
    expect(second).toBe(first);
    expect(first.enabled).toBe(true);
  });
});

describe('toPromptContext', () => {
  it('passes instructions through', () => {
    const agent = makeAgent({ customInstructions: 'Treat names as attributes.' });
    expect(toPromptContext(agent)).toEqual({ instructions: 'Treat names as attributes.' });
  });

  it('normalizes empty and whitespace-only instructions to undefined', () => {
    expect(toPromptContext(makeAgent({ customInstructions: '' })).instructions).toBeUndefined();
    expect(toPromptContext(makeAgent({ customInstructions: '   \n ' })).instructions).toBeUndefined();
  });
});

describe('extraction prompt instruction injection (regression for the dropped-instructions bug)', () => {
  it('emits a Custom Instructions block when instructions are provided', () => {
    const prompt = getQuickExtractSystemPrompt(false, 'AVOID person names as nodes');
    expect(prompt).toContain('## Custom Instructions');
    expect(prompt).toContain('AVOID person names as nodes');
  });

  it('emits no Custom Instructions block when instructions are undefined', () => {
    const prompt = getQuickExtractSystemPrompt(false, undefined);
    expect(prompt).not.toContain('## Custom Instructions');
  });
});
