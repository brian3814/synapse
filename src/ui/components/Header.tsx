import React from 'react';
import { useDisplayMode } from '../hooks/useDisplayMode';
import { useUIStore } from '../../graph/store/ui-store';
// graph-store no longer needed here — stats moved to GraphControls
import { useReadingListStore } from '../../graph/store/reading-list-store';
import { HeaderSearch } from './search/HeaderSearch';

export function Header() {
  const { displayMode, toggleMode } = useDisplayMode();
  const { activePanel, setActivePanel, clusteringEnabled, toggleClustering, chatOpen, toggleChat } = useUIStore();
  const readingListItems = useReadingListStore((s) => s.items);
  const readyCount = Object.values(readingListItems).filter(i => i.status === 'extracted').length;
  const isSidePanel = displayMode === 'sidePanel';

  return (
    <header className="flex items-center gap-2 px-3 bg-zinc-800 border-b border-zinc-700 shrink-0" style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem', fontSize: '16px' }}>
      <div className="flex items-center gap-2 shrink-0">
        <h1 className="font-semibold text-zinc-100" style={{ fontSize: '16px' }}>Knowledge Graph</h1>
      </div>

      <HeaderSearch />

      <div className="flex items-center gap-1 shrink-0 ml-auto">
        <ToolbarButton
          active={activePanel === 'readingList'}
          onClick={() => setActivePanel('readingList')}
          title="Reading List"
        >
          <span className="relative">
            <BookmarkListIcon />
            {readyCount > 0 && (
              <span className="absolute -top-1.5 -right-2 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[9px] font-bold bg-emerald-500 text-white rounded-full leading-none">
                {readyCount}
              </span>
            )}
          </span>
        </ToolbarButton>

        <ToolbarButton
          active={activePanel === 'query'}
          onClick={() => setActivePanel('query')}
          title="Query"
        >
          <FilterIcon />
        </ToolbarButton>

        <ToolbarButton
          active={activePanel === 'create'}
          onClick={() => setActivePanel('create')}
          title="Create"
        >
          <PlusIcon />
        </ToolbarButton>

        <ToolbarButton
          active={activePanel === 'llm'}
          onClick={() => setActivePanel('llm')}
          title="LLM Extract"
        >
          <SparklesIcon />
        </ToolbarButton>

        <ToolbarButton
          active={activePanel === 'notes'}
          onClick={() => setActivePanel('notes')}
          title="Notes"
        >
          <NoteIcon />
        </ToolbarButton>

        <ToolbarButton
          active={activePanel === 'intelligence'}
          onClick={() => setActivePanel('intelligence')}
          title="Intelligence"
        >
          <BrainIcon />
        </ToolbarButton>

        <ToolbarButton
          active={chatOpen}
          onClick={toggleChat}
          title="Ask (chat)"
        >
          <ChatIcon />
        </ToolbarButton>

        <div className="w-px h-4 bg-zinc-600 mx-1" />

        <ToolbarButton
          active={clusteringEnabled}
          onClick={toggleClustering}
          title="Toggle clustering"
        >
          <ClusterIcon />
        </ToolbarButton>

        <div className="w-px h-4 bg-zinc-600 mx-1" />

        <ToolbarButton
          active={activePanel === 'settings'}
          onClick={() => setActivePanel('settings')}
          title="Settings"
        >
          <GearIcon />
        </ToolbarButton>

        <ToolbarButton onClick={toggleMode} title={isSidePanel ? 'Pop out to tab' : 'Dock to side panel'}>
          {isSidePanel ? <ExternalIcon /> : <PanelIcon />}
        </ToolbarButton>
      </div>
    </header>
  );
}

function ToolbarButton({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-indigo-600 text-white'
          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
      }`}
    >
      {children}
    </button>
  );
}

// Simple SVG icons (16x16)
const BookmarkListIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
    <line x1="9" y1="10" x2="15" y2="10"/>
    <line x1="9" y1="14" x2="15" y2="14"/>
  </svg>
);

const FilterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
);

const SparklesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/>
  </svg>
);

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
  </svg>
);

const NoteIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

const BrainIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 2a4 4 0 0 1 4 4 4 4 0 0 1-1 6.5V20a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2v-7.5A4 4 0 0 1 8 6a4 4 0 0 1 4-4z"/>
    <path d="M8 6a4 4 0 0 0-4 4c0 1.5.8 2.8 2 3.4"/>
    <path d="M16 6a4 4 0 0 1 4 4c0 1.5-.8 2.8-2 3.4"/>
  </svg>
);

const ClusterIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="12" cy="12" r="3"/><circle cx="5" cy="7" r="2"/><circle cx="19" cy="7" r="2"/><circle cx="5" cy="17" r="2"/><circle cx="19" cy="17" r="2"/>
  </svg>
);

const GearIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);

const ExternalIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const PanelIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>
  </svg>
);
