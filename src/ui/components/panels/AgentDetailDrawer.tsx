import { useState, useCallback, useEffect, useRef } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import { ToolToggleRow } from '../settings/ToolToggleRow';
import { categorizeToolDefs } from '../../../shared/tool-categories';
import { platformId } from '@platform';
import type { AgentDefinition } from '../../../shared/agent-definition-types';

const MIN_DRAWER_W = 260;
const MAX_DRAWER_W = 480;
const DEFAULT_DRAWER_W = 320;

interface AgentDetailDrawerProps {
  agentId: string;
  onClose: () => void;
}

export function AgentDetailDrawer({ agentId, onClose }: AgentDetailDrawerProps) {
  const storeAgent = useAgentStore((s) => s.agents.find(a => a.id === agentId));
  const saveAgent = useAgentStore((s) => s.saveAgent);
  const deleteAgent = useAgentStore((s) => s.deleteAgent);
  const resetBuiltinAgent = useAgentStore((s) => s.resetBuiltinAgent);
  const duplicateAgent = useAgentStore((s) => s.duplicateAgent);

  const [draft, setDraft] = useState<AgentDefinition | null>(null);
  const [saved, setSaved] = useState(false);
  const [registryTools, setRegistryTools] = useState<Array<{ name: string; description: string; category?: string }>>([]);
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_DRAWER_W);
  const dragging = useRef(false);
  const lastX = useRef(0);

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

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    await saveAgent(draft);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [draft, saveAgent]);

  const handleDelete = useCallback(async () => {
    await deleteAgent(agentId);
    onClose();
  }, [deleteAgent, agentId, onClose]);

  const handleReset = useCallback(async () => {
    await resetBuiltinAgent(agentId);
  }, [resetBuiltinAgent, agentId]);

  const handleDuplicate = useCallback(async () => {
    await duplicateAgent(agentId);
  }, [duplicateAgent, agentId]);

  const updateDraft = useCallback((updates: Partial<AgentDefinition>) => {
    setDraft(d => d ? { ...d, ...updates } : d);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = lastX.current - e.clientX;
    lastX.current = e.clientX;
    setDrawerWidth(w => Math.min(MAX_DRAWER_W, Math.max(MIN_DRAWER_W, w + delta)));
  }, []);
  const onPointerUp = useCallback(() => { dragging.current = false; }, []);

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
    <div className="flex shrink-0 min-h-0" style={{ width: drawerWidth }}>
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="w-1 shrink-0 cursor-col-resize bg-zinc-700 hover:bg-indigo-500 active:bg-indigo-400 transition-colors"
      />
      <div className="flex-1 border-l border-zinc-700 bg-zinc-900 flex flex-col min-h-0 min-w-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-zinc-700 shrink-0">
        <div className="w-7 h-7 rounded-md bg-zinc-800 flex items-center justify-center text-[15px] shrink-0">
          {draft.icon}
        </div>
        <div className="flex-1 min-w-0">
          {isBuiltin ? (
            <div className="text-sm font-semibold text-zinc-100 truncate">{draft.name}</div>
          ) : (
            <input
              value={draft.name}
              onChange={(e) => updateDraft({ name: e.target.value })}
              className="w-full bg-transparent text-sm font-semibold text-zinc-100 outline-none border-b border-transparent focus:border-indigo-500"
            />
          )}
          <div className="flex items-center gap-1 mt-0.5">
            <span className="text-[10px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">{draft.kind}</span>
            <span className={`text-[10px] px-1 py-0.5 rounded ${draft.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700 text-zinc-500'}`}>
              {draft.enabled ? 'active' : 'disabled'}
            </span>
          </div>
        </div>
        <button onClick={onClose} className="p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 min-h-0">
        {/* Description */}
        {!isBuiltin && (
          <DrawerSection label="Description">
            <input
              value={draft.description}
              onChange={(e) => updateDraft({ description: e.target.value })}
              placeholder="Agent description..."
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2.5 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600"
            />
          </DrawerSection>
        )}

        {/* Instructions */}
        <DrawerSection label="Instructions">
          <textarea
            value={draft.customInstructions}
            onChange={(e) => updateDraft({ customInstructions: e.target.value })}
            placeholder="System prompt additions..."
            rows={3}
            className="w-full bg-zinc-800 border border-zinc-600 rounded px-2.5 py-2 text-xs text-zinc-100 outline-none focus:border-indigo-500 placeholder-zinc-600 resize-y"
          />
        </DrawerSection>

        {/* Conversation Starters */}
        <DrawerSection label="Starters">
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
                  className="flex-1 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    const starters = (draft.conversationStarters || []).filter((_, j) => j !== i);
                    updateDraft({ conversationStarters: starters });
                  }}
                  className="text-zinc-500 hover:text-red-400 p-1"
                >
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M18 6 6 18M6 6l12 12" />
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
        </DrawerSection>

        {/* Max Iterations */}
        <DrawerSection label="Max iterations">
          <div className="flex items-center gap-1.5">
            <input
              type="number"
              min={5}
              max={500}
              value={draft.maxIterations}
              onChange={(e) => updateDraft({ maxIterations: Math.max(5, Math.min(500, parseInt(e.target.value) || 100)) })}
              className="w-14 bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-100 outline-none focus:border-indigo-500 text-center"
            />
            <span className="text-[11px] text-zinc-600">LLM round-trips</span>
          </div>
        </DrawerSection>

        {/* Tools */}
        {toolCategories.length > 0 && toolCategories.map(({ category, label, tools, variant }) => (
          <DrawerSection key={category} label={label}>
            <div className="space-y-0.5">
              {tools.map(tool => (
                <ToolToggleRow
                  key={tool.name}
                  name={tool.name}
                  description={tool.description.slice(0, 60) + (tool.description.length > 60 ? '...' : '')}
                  enabled={isToolEnabled(tool.name)}
                  variant={variant}
                  onToggle={handleToolToggle}
                />
              ))}
            </div>
          </DrawerSection>
        ))}
      </div>

      {/* Footer */}
      <div className="flex gap-1.5 px-4 py-3 border-t border-zinc-700 shrink-0">
        <button
          onClick={handleSave}
          className="flex-1 text-center py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
        >
          {saved ? 'Saved!' : 'Save'}
        </button>
        <button
          onClick={handleDuplicate}
          className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          Duplicate
        </button>
        {isBuiltin ? (
          <button
            onClick={handleReset}
            className="px-3 py-1.5 rounded-md text-xs border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            Reset
          </button>
        ) : (
          <button
            onClick={handleDelete}
            className="px-3 py-1.5 rounded-md text-xs border border-red-900/50 text-red-400 hover:bg-red-900/30 transition-colors"
          >
            Delete
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

function DrawerSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider mb-1.5">{label}</div>
      {children}
    </div>
  );
}
