import { useState } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import { AgentListView } from './AgentListView';
import { AgentDetailView } from './AgentDetailView';

export function AgentsPanel() {
  const loaded = useAgentStore((s) => s.loaded);
  const [editingId, setEditingId] = useState<string | null>(null);

  if (!loaded) {
    return (
      <div className="p-4">
        <p className="text-xs text-zinc-500">Loading agents...</p>
      </div>
    );
  }

  if (editingId) {
    return <AgentDetailView agentId={editingId} onBack={() => setEditingId(null)} />;
  }

  return <AgentListView onEditAgent={setEditingId} />;
}
