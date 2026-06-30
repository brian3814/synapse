import React, { useCallback } from 'react';
import { useDisplayMode } from '../hooks/useDisplayMode';
import { useUIStore } from '../../graph/store/ui-store';
import { HeaderSearch } from './search/HeaderSearch';
import { VaultSwitcher } from './VaultSwitcher';
import { Tooltip } from './shared/Tooltip';
import { browser } from '@platform';

export function Header() {
  const { displayMode, toggleMode } = useDisplayMode();
  const { settingsOpen, setSettingsOpen } = useUIStore();
  const isSidePanel = displayMode === 'sidePanel';

  const handleSettingsClick = useCallback(() => {
    if (isSidePanel) {
      (browser as any).openSettingsTab?.();
    } else {
      setSettingsOpen(!settingsOpen);
    }
  }, [isSidePanel, settingsOpen, setSettingsOpen]);

  return (
    <header className="flex items-center gap-2 px-3 bg-zinc-800 border-b border-zinc-700 shrink-0" style={{ paddingTop: '0.5rem', paddingBottom: '0.5rem', fontSize: '16px' }}>
      <div className="flex items-center gap-2 shrink-0">
        <h1 className="font-semibold text-zinc-100" style={{ fontSize: '16px' }}>Synapse</h1>
      </div>

      <VaultSwitcher />

      <div className="flex-1" />

      <div className="flex items-center gap-1 shrink-0">
        <HeaderSearch />

        <div className="w-px h-4 bg-zinc-600 mx-1" />

        <ToolbarButton
          active={settingsOpen}
          onClick={handleSettingsClick}
          title="Settings"
        >
          <GearIcon />
        </ToolbarButton>

        {displayMode !== 'desktop' && (
          <ToolbarButton onClick={toggleMode} title={isSidePanel ? 'Pop out to tab' : 'Dock to side panel'}>
            {isSidePanel ? <ExternalIcon /> : <PanelIcon />}
          </ToolbarButton>
        )}
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
    <Tooltip text={title}>
      <button
        onClick={onClick}
        className={`p-1.5 rounded transition-colors ${
          active
            ? 'bg-indigo-600 text-white'
            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
        }`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

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
