import { useState, useCallback, useEffect } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import { ToolToggleRow } from '../settings/ToolToggleRow';
import { categorizeToolDefs } from '../../../shared/tool-categories';
import { platformId } from '@platform';
import type { AgentDefinition } from '../../../shared/agent-definition-types';

interface AgentDetailViewProps {
  agentId: string;
  onBack: () => void;
}

export function AgentDetailView({ agentId, onBack }: AgentDetailViewProps) {
  const storeAgent = useAgentStore((s) => s.agents.find(a => a.id === agentId));
  const saveAgent = useAgentStore((s) => s.saveAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const resetBuiltinAgent = useAgentStore((s) => s.resetBuiltinAgent);
  const duplicateAgent = useAgentStore((s) => s.duplicateAgent);

  const [draft, setDraft] = useState<AgentDefinition | null>(null);
  const [saved, setSaved] = useState(false);
  const [registryTools, setRegistryTools] = useState<Array<{ name: string; description: string; category?: string }>>([]);

  useEffect(() => {
    if (storeAgent) setDraft({ ...storeAgent });
  }, [storeAgent]);

  useEffect(() => {
    if (platformId === 'electron') {
      (window as any).electronIPC.invoke('tools:list', {}).then((tools: any[]) => {
        setRegistryTools(tools.map((t: any) => ({ name: t.name, description: t.description, category: t.category })));
      }).catch(() => {});
    }
  }, []);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    await saveAgent(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, saveAgent]);

  const handleDelete = useCallback(async () => {
    await deleteAgent(agentId);
    onBack();
  }, [deleteAgent, agentId, onBack]);

  const handleDuplicate = useCallback(async () => {
    await duplicateAgent(agentId);
  }, [duplicateAgent, agentId]);

  const handleReset = useCallback(async () => {
    await resetBuiltinAgent(agentId);
  }, [resetBuiltinAgent, agentId]);

  const updateDraft = useCallback((updates: Partial<AgentDefinition>) => {
    setDraft(d => d ? { ...d, ...updates } : d);
  }, []);

  if (!draft) return null;

  const isBuiltin = draft.scope === 'builtin';
  const toolCategories = categorizeToolDefs(registryTools);

  const isToolEnabled = (name: string) => {
    if (draft.tools?.length) return draft.tools.includes(name);
    if (draft.disallowedTools?.length) return !draft.disallowedTools.includes(name);
    return true;
  };

  const handleToolToggle = (name: string, enabled: boolean) => {
    if (draft.tools?.length) {
      const tools = enabled ? [...draft.tools, name] : draft.tools.filter(t => t !== name);
      setDraft({ ...draft, tools });
    } else {
      const disallowedTools = enabled
        ? (draft.disallowedTools || []).filter(t => t !== name)
        : [...(draft.disallowedTools || []), name];
      setDraft({ ...draft, disallowedTools });
    }
  };

  return (
    <div className="p-3 space-y-3">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-[10px] text-zinc-400 hover:text-zinc-200 -ml-1"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
        Back
      </button>

      <div className="flex items-center gap-2">
        <span className="text-lg">{draft.icon}</span>
        <div className="flex-1 min-w-0">
          {isBuiltin ? (
            <h3 className="text-xs font-semibold text-zinc-200">{draft.name}</h3>
          ) : (
            <input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              className="w-full bg-transparent text-xs font-semibold text-zinc-200 outline-none border-b border-zinc-600 focus:border-indigo-500 pb-0.5"
            />
          )}
          {isBuiltin ? (
            <p className="text-[10px] text-zinc-500">{draft.description}</p>
          ) : (
            <input
              value={draft.description}
              onChange={(e) => updateDraft({ description: e.target.value })}
              placeholder="Description..."
              className="w-full bg-transparent text-[10px] text-zinc-500 outline-none border-b border-zinc-700 focus:border-indigo-500 mt-0.5 pb-0.5"
            />
          )}
        </div>
      </div>

      {/* Custom Instructions */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Custom Instructions</label>
        <textarea
          value={draft.customInstructions}
          onChange={(e) => updateDraft({ customInstructions: e.target.value })}
          placeholder="System prompt additions appended after the base prompt..."
          rows={4}
          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
        />
      </div>

      {/* Conversation Starters */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Conversation Starters</label>
        <div className="space-y-1">
          {(draft.conversationStarters || []).map((starter, i) => (
            <div key={i} className="flex gap-1">
              <input
                value={starter}
                onChange={(e) => {
                  const starters = [...(draft.conversationStarters || [])];
                  starters[i] = e.target.value;
                  updateDraft({ conversationStarters: starters });
                }}
                className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
              />
              <button
                onClick={() => {
                  const starters = (draft.conversationStarters || []).filter((_, j) => j !== i);
                  updateDraft({ conversationStarters: starters });
                }}
                className="text-zinc-500 hover:text-red-400 p-1"
              >
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6 6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
          {(draft.conversationStarters?.length ?? 0) < 4 && (
            <button
              onClick={() => updateDraft({ conversationStarters: [...(draft.conversationStarters || []), ''] })}
              className="text-[10px] text-indigo-400 hover:text-indigo-300"
            >
              + Add starter
            </button>
          )}
        </div>
      </div>

      {/* Max Iterations */}
      <div>
        <label className="text-[10px] text-zinc-500 block mb-1">Max Iterations</label>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={5}
            max={500}
            value={draft.maxIterations}
            onChange={(e) => updateDraft({ maxIterations: Math.max(5, Math.min(500, parseInt(e.target.value) || 100)) })}
            className="w-20 bg-zinc-800 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-100 outline-none focus:border-indigo-500"
          />
          <span className="text-[10px] text-zinc-600">LLM round-trips per request</span>
        </div>
      </div>

      {/* Tools */}
      {toolCategories.length > 0 && (
        <div>
          <label className="text-[10px] text-zinc-500 block mb-1">Tools</label>
          <div className="space-y-2">
            {toolCategories.map(({ category, label, tools, variant }) => (
              <div key={category}>
                <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">{label}</span>
                <div className="space-y-0.5 mt-0.5">
                  {tools.map(tool => (
                    <ToolToggleRow
                      key={tool.name}
                      name={tool.name}
                      description={tool.description.slice(0, 80) + (tool.description.length > 80 ? '...' : '')}
                      enabled={isToolEnabled(tool.name)}
                      variant={variant}
                      onToggle={handleToolToggle}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Save + Actions */}
      <div className="space-y-2 pt-2 border-t border-zinc-700">
        <button
          onClick={handleSave}
          className="w-full bg-indigo-600 text-white text-xs py-1.5 rounded hover:bg-indigo-500 transition-colors"
        >
          {saved ? 'Saved!' : 'Save Changes'}
        </button>

        <div className="flex gap-2">
          <button
            onClick={handleDuplicate}
            className="flex-1 bg-zinc-700 text-zinc-200 text-xs py-1.5 rounded hover:bg-zinc-600 transition-colors"
          >
            Duplicate
          </button>
          {isBuiltin ? (
            <button
              onClick={handleReset}
              className="flex-1 bg-zinc-700 text-zinc-200 text-xs py-1.5 rounded hover:bg-zinc-600 transition-colors"
            >
              Reset
            </button>
          ) : (
            <button
              onClick={handleDelete}
              className="flex-1 bg-red-900/30 text-red-400 text-xs py-1.5 rounded border border-red-900/50 hover:bg-red-900/50 transition-colors"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
