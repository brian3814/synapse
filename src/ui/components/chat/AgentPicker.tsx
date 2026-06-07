import { useState, useEffect, useRef } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import { useUIStore } from '../../../graph/store/ui-store';

export function AgentPicker() {
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const setLeftPanel = useUIStore((s) => s.setLeftPanel);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const agents = useAgentStore.getState().agents.filter(a => a.kind === 'chat' && a.enabled);
  const activeAgent = agents.find(a => a.id === activeAgentId) ?? agents[0];
  if (!activeAgent) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
        title="Select agent"
      >
        <span className="text-xs">{activeAgent.icon}</span>
        <span>{activeAgent.name}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {agents.map(agent => (
            <button
              key={agent.id}
              onClick={() => { setActiveAgent(agent.id); setOpen(false); }}
              className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
                activeAgentId === agent.id
                  ? 'bg-indigo-600/20 text-indigo-300'
                  : 'text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <span className="text-sm">{agent.icon}</span>
              <div className="flex-1 min-w-0">
                <span className="text-xs block truncate">{agent.name}</span>
                <span className="text-[9px] text-zinc-500 block truncate">{agent.description}</span>
              </div>
            </button>
          ))}

          <button
            onClick={() => { setLeftPanel('agents'); setOpen(false); }}
            className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-zinc-700 border-t border-zinc-700 transition-colors"
          >
            Manage Agents...
          </button>
        </div>
      )}
    </div>
  );
}
