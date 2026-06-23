import { useAgentStore } from '../../../graph/store/agent-store';
import type { AgentScope, CoreFeature } from '../../../shared/agent-definition-types';

const SCOPE_LABELS: Record<AgentScope, string> = {
  builtin: 'Built-in',
  user: 'Custom',
  vault: 'Vault',
};

function AgentSelect({
  label,
  helper,
  feature,
  kind,
}: {
  label: string;
  helper?: string;
  feature: CoreFeature;
  kind: 'chat' | 'extraction';
}) {
  const agents = useAgentStore((s) => s.agents);
  const featureAgents = useAgentStore((s) => s.featureAgents);
  const setFeatureAgent = useAgentStore((s) => s.setFeatureAgent);

  const options = agents.filter((a) => a.kind === kind && a.enabled);
  const value = featureAgents[feature] ?? '';

  return (
    <div>
      <label className="text-xs font-medium text-zinc-400 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => setFeatureAgent(feature, e.target.value || null)}
        className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200"
      >
        <option value="">(automatic)</option>
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.icon} {a.name} — {SCOPE_LABELS[a.scope]}
          </option>
        ))}
      </select>
      {helper && <p className="text-[10px] text-zinc-500 mt-1">{helper}</p>}
    </div>
  );
}

export function AgentAssignmentsTab() {
  return (
    <div className="p-5 space-y-5">
      <div className="space-y-3">
        <h3 className="text-xs font-semibold text-zinc-300 uppercase tracking-wide">Feature Agents</h3>
        <p className="text-xs text-zinc-500">
          Choose which agent each core feature uses. Create and configure agents in the
          Agents panel (left sidebar). "(automatic)" uses the built-in agent for that feature.
        </p>
        <AgentSelect
          label="Extraction agent"
          feature="extraction"
          kind="extraction"
          helper="Used by text extraction, page extraction, agent extraction, and file ingestion."
        />
        <AgentSelect
          label="Default chat agent"
          feature="chat"
          kind="chat"
          helper="The chat header picker can still switch agents per conversation; this sets the default."
        />
      </div>
    </div>
  );
}
