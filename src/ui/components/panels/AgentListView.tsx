import { useAgentStore } from '../../../graph/store/agent-store';
import type { AgentDefinition, AgentScope } from '../../../shared/agent-definition-types';

interface AgentListViewProps {
  onEditAgent: (id: string) => void;
}

const SCOPE_ORDER: AgentScope[] = ['builtin', 'user', 'vault'];
const SCOPE_LABELS: Record<AgentScope, string> = {
  builtin: 'Built-in',
  user: 'Custom',
  vault: 'Vault',
};

export function AgentListView({ onEditAgent }: AgentListViewProps) {
  const agents = useAgentStore((s) => s.agents);
  const activeAgentId = useAgentStore((s) => s.activeAgentId);
  const toggleEnabled = useAgentStore((s) => s.toggleAgentEnabled);
  const setActiveAgent = useAgentStore((s) => s.setActiveAgent);
  const duplicateAgent = useAgentStore((s) => s.duplicateAgent);

  const grouped = new Map<AgentScope, AgentDefinition[]>();
  for (const scope of SCOPE_ORDER) {
    const items = agents.filter(a => a.scope === scope);
    if (items.length > 0) grouped.set(scope, items);
  }

  const handleCreate = async (kind: 'chat' | 'extraction') => {
    const newAgent = await duplicateAgent(kind === 'chat' ? 'chat' : 'extraction');
    onEditAgent(newAgent.id);
  };

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-200">Agents</h3>
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleCreate('chat')}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-zinc-700"
          >
            + Chat
          </button>
          <button
            onClick={() => handleCreate('extraction')}
            className="text-[10px] text-indigo-400 hover:text-indigo-300 px-1.5 py-0.5 rounded hover:bg-zinc-700"
          >
            + Extraction
          </button>
        </div>
      </div>

      {[...grouped.entries()].map(([scope, items]) => (
        <div key={scope}>
          <span className="text-[9px] font-medium text-zinc-500 uppercase tracking-wider">
            {SCOPE_LABELS[scope]}
          </span>
          <div className="mt-1 space-y-0.5">
            {items.map(agent => (
              <AgentRow
                key={agent.id}
                agent={agent}
                isActive={agent.id === activeAgentId}
                onEdit={() => onEditAgent(agent.id)}
                onToggle={() => toggleEnabled(agent.id)}
                onActivate={() => agent.kind === 'chat' && setActiveAgent(agent.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgentRow({
  agent,
  isActive,
  onEdit,
  onToggle,
  onActivate,
}: {
  agent: AgentDefinition;
  isActive: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onActivate: () => void;
}) {
  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors group ${
        isActive ? 'bg-indigo-600/15 border border-indigo-500/30' : 'hover:bg-zinc-800 border border-transparent'
      }`}
      onClick={onEdit}
    >
      <span className="text-sm shrink-0" title={agent.kind}>{agent.icon}</span>
      <div className="flex-1 min-w-0" onDoubleClick={(e) => { e.stopPropagation(); onActivate(); }}>
        <div className="flex items-center gap-1">
          <span className="text-xs text-zinc-200 truncate">{agent.name}</span>
          {agent.scope === 'builtin' && (
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="text-zinc-500 shrink-0">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          )}
        </div>
        <p className="text-[10px] text-zinc-500 truncate">{agent.description}</p>
      </div>
      <label
        className="shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          type="checkbox"
          checked={agent.enabled}
          onChange={onToggle}
          className="toggle-switch"
        />
      </label>
    </div>
  );
}
