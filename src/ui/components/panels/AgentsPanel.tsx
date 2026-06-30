import { useState, useCallback } from 'react';
import { useAgentStore } from '../../../graph/store/agent-store';
import { AgentGridView } from './AgentGridView';
import { AgentDetailDrawer } from './AgentDetailDrawer';

type SubTab = 'agents' | 'connections';
type ViewMode = 'grid' | 'list';

export function AgentsPanel() {
  const loaded = useAgentStore((s) => s.loaded);
  const agents = useAgentStore((s) => s.agents);
  const duplicateAgent = useAgentStore((s) => s.duplicateAgent);

  const [subTab, setSubTab] = useState<SubTab>('agents');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [filterText, setFilterText] = useState('');

  const handleCreate = useCallback(async () => {
    const newAgent = await duplicateAgent('chat');
    setSelectedAgentId(newAgent.id);
  }, [duplicateAgent]);

  const handleCloseDrawer = useCallback(() => {
    setSelectedAgentId(null);
  }, []);

  if (!loaded) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-zinc-500">Loading agents...</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 h-full">
      {/* Sub-nav tabs */}
      <div className="flex border-b border-zinc-700 shrink-0 px-5">
        <TabButton active={subTab === 'agents'} onClick={() => setSubTab('agents')}>Agents</TabButton>
        <TabButton active={subTab === 'connections'} onClick={() => setSubTab('connections')}>Connections</TabButton>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2.5 px-5 py-3 border-b border-zinc-700 shrink-0 flex-wrap">
        <span className="text-[15px] font-semibold text-zinc-100">
          {subTab === 'agents' ? 'Agents' : 'Connections'}
        </span>
        <span className="text-xs text-zinc-500">
          {subTab === 'agents' ? agents.length : '—'}
        </span>
        <div className="flex-1" />

        {/* Filter */}
        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md border border-zinc-700 text-xs text-zinc-500 min-w-[140px]">
          <SearchIcon />
          <input
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            placeholder={subTab === 'agents' ? 'Filter agents...' : 'Filter connections...'}
            className="flex-1 bg-transparent outline-none text-zinc-300 placeholder-zinc-600 text-xs"
          />
        </div>

        {/* Grid/List toggle */}
        <div className="flex items-center border border-zinc-700 rounded-md overflow-hidden">
          <button
            onClick={() => setViewMode('grid')}
            className={`p-1.5 transition-colors ${viewMode === 'grid' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            title="Grid view"
          >
            <GridIcon />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={`p-1.5 transition-colors ${viewMode === 'list' ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'}`}
            title="List view"
          >
            <ListIcon />
          </button>
        </div>

        {/* Create */}
        {subTab === 'agents' && (
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 transition-colors"
          >
            + Agent
          </button>
        )}
      </div>

      {/* Content + Drawer */}
      <div className="flex-1 flex min-h-0">
        {/* Main content */}
        <div className="flex-1 overflow-y-auto p-5 min-w-0">
          {subTab === 'agents' ? (
            <AgentGridView
              viewMode={viewMode}
              filterText={filterText}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          ) : (
            <div className="text-xs text-zinc-500 text-center py-8">
              MCP connections will appear here when configured.
            </div>
          )}
        </div>

        {/* Detail drawer */}
        {selectedAgentId && subTab === 'agents' && (
          <AgentDetailDrawer
            agentId={selectedAgentId}
            onClose={handleCloseDrawer}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-3.5 py-2 text-[13px] border-b-2 transition-colors ${
        active
          ? 'text-zinc-100 font-medium border-indigo-500'
          : 'text-zinc-500 border-transparent hover:text-zinc-300'
      }`}
    >
      {children}
    </button>
  );
}

const SearchIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
  </svg>
);

const GridIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
  </svg>
);

const ListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
  </svg>
);
