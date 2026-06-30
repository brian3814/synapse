import { useMemo } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import type { AgentDefinition } from '../../../shared/agent-definition-types';

interface AgentGridViewProps {
  viewMode: 'grid' | 'list';
  filterText: string;
  selectedAgentId: string | null;
  onSelectAgent: (id: string) => void;
}

const KIND_COLORS: Record<string, { bg: string; text: string }> = {
  chat: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
  extraction: { bg: 'bg-purple-500/10', text: 'text-purple-400' },
};

const SCOPE_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  builtin: { bg: 'bg-emerald-500/10', text: 'text-emerald-400', label: 'built-in' },
  user: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'custom' },
  vault: { bg: 'bg-amber-500/10', text: 'text-amber-400', label: 'vault' },
};

export function AgentGridView({ viewMode, filterText, selectedAgentId, onSelectAgent }: AgentGridViewProps) {
  const agents = useAgentStore((s) => s.agents);
  const toggleEnabled = useAgentStore((s) => s.toggleAgentEnabled);

  const filtered = useMemo(() => {
    if (!filterText) return agents;
    const q = filterText.toLowerCase();
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q)
    );
  }, [agents, filterText]);

  if (viewMode === 'grid') {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2.5">
        {filtered.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            selected={agent.id === selectedAgentId}
            onSelect={() => onSelectAgent(agent.id)}
            onToggle={() => toggleEnabled(agent.id)}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      <div className="grid grid-cols-[1fr_80px_80px_60px] gap-3 px-4 py-1.5 text-[10px] font-medium text-zinc-500 uppercase tracking-wider">
        <span>Agent</span>
        <span>Type</span>
        <span>Scope</span>
        <span>Status</span>
      </div>
      {filtered.map((agent) => (
        <AgentListRow
          key={agent.id}
          agent={agent}
          selected={agent.id === selectedAgentId}
          onSelect={() => onSelectAgent(agent.id)}
          onToggle={() => toggleEnabled(agent.id)}
        />
      ))}
    </div>
  );
}

function AgentCard({
  agent, selected, onSelect, onToggle,
}: {
  agent: AgentDefinition; selected: boolean; onSelect: () => void; onToggle: () => void;
}) {
  const kindColor = KIND_COLORS[agent.kind] ?? KIND_COLORS.chat;
  const scopeColor = SCOPE_COLORS[agent.scope] ?? SCOPE_COLORS.user;

  return (
    <div
      onClick={onSelect}
      className={`p-4 rounded-lg border cursor-pointer transition-colors flex flex-col gap-2.5 ${
        selected
          ? 'border-indigo-500 bg-indigo-500/5 ring-1 ring-indigo-500'
          : 'border-zinc-700 bg-zinc-900 hover:border-zinc-600'
      } ${!agent.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-lg bg-zinc-800 flex items-center justify-center text-lg shrink-0">
          {agent.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-zinc-100 truncate">{agent.name}</div>
          <div className="text-[11px] text-zinc-500 truncate mt-0.5">{agent.description}</div>
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${kindColor.bg} ${kindColor.text} font-medium`}>
          {agent.kind}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${scopeColor.bg} ${scopeColor.text} font-medium`}>
          {scopeColor.label}
        </span>
        <div className="flex-1" />
        <label onClick={(e) => e.stopPropagation()}>
          <ToggleSwitch enabled={agent.enabled} onToggle={onToggle} />
        </label>
      </div>
    </div>
  );
}

function AgentListRow({
  agent, selected, onSelect, onToggle,
}: {
  agent: AgentDefinition; selected: boolean; onSelect: () => void; onToggle: () => void;
}) {
  const kindColor = KIND_COLORS[agent.kind] ?? KIND_COLORS.chat;
  const scopeColor = SCOPE_COLORS[agent.scope] ?? SCOPE_COLORS.user;

  return (
    <div
      onClick={onSelect}
      className={`grid grid-cols-[1fr_80px_80px_60px] gap-3 px-4 py-2.5 items-center cursor-pointer rounded transition-colors ${
        selected
          ? 'bg-indigo-500/5 border-l-2 border-l-indigo-500'
          : 'hover:bg-zinc-800/50 border-l-2 border-l-transparent'
      } ${!agent.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="text-base shrink-0">{agent.icon}</span>
        <div className="min-w-0">
          <div className="text-[13px] font-medium text-zinc-100 truncate">{agent.name}</div>
          <div className="text-[11px] text-zinc-500 truncate">{agent.description}</div>
        </div>
      </div>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${kindColor.bg} ${kindColor.text} font-medium w-fit`}>
        {agent.kind}
      </span>
      <span className={`text-[10px] px-1.5 py-0.5 rounded ${scopeColor.bg} ${scopeColor.text} font-medium w-fit`}>
        {scopeColor.label}
      </span>
      <label onClick={(e) => e.stopPropagation()}>
        <ToggleSwitch enabled={agent.enabled} onToggle={onToggle} />
      </label>
    </div>
  );
}

function ToggleSwitch({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <div
      onClick={onToggle}
      className={`w-7 h-4 rounded-full relative cursor-pointer transition-colors ${
        enabled ? 'bg-emerald-500' : 'bg-zinc-600'
      }`}
    >
      <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all ${
        enabled ? 'right-0.5' : 'left-0.5'
      }`} />
    </div>
  );
}
