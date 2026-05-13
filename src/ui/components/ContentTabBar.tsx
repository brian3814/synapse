import React, { useCallback } from 'react';
import { useUIStore } from '../../graph/store/ui-store';
import type { ContentTab } from '../../graph/store/ui-store';

export function ContentTabBar() {
  const contentTabs = useUIStore((s) => s.contentTabs);
  const activeContentTabId = useUIStore((s) => s.activeContentTabId);
  const focusContentTab = useUIStore((s) => s.focusContentTab);
  const closeContentTab = useUIStore((s) => s.closeContentTab);

  if (contentTabs.length <= 1) return null;

  return (
    <div className="flex items-center bg-zinc-800/80 border-b border-zinc-700 shrink-0 overflow-x-auto scrollbar-none">
      {contentTabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeContentTabId}
          onFocus={focusContentTab}
          onClose={closeContentTab}
        />
      ))}
    </div>
  );
}

function TabItem({
  tab,
  active,
  onFocus,
  onClose,
}: {
  tab: ContentTab;
  active: boolean;
  onFocus: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const isGraph = tab.type.kind === 'graph';

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 && !isGraph) {
      e.preventDefault();
      onClose(tab.id);
    }
  }, [tab.id, isGraph, onClose]);

  return (
    <button
      onClick={() => onFocus(tab.id)}
      onMouseDown={handleMouseDown}
      className={`group flex items-center gap-1.5 px-3 h-7 text-[11px] whitespace-nowrap border-r border-zinc-700/50 shrink-0 transition-colors ${
        active
          ? 'bg-zinc-900 text-zinc-100 border-b-2 border-b-indigo-500'
          : 'bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border-b-2 border-b-transparent'
      }`}
      style={{ maxWidth: 180 }}
    >
      {isGraph ? <GraphIcon /> : <NoteTabIcon />}
      <span className="truncate">{tab.title}</span>
      {!isGraph && (
        <span
          onClick={(e) => { e.stopPropagation(); onClose(tab.id); }}
          className="ml-1 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-zinc-600 transition-opacity"
        >
          <CloseIcon />
        </span>
      )}
    </button>
  );
}

const GraphIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" />
    <line x1="15.5" y1="6" x2="8.5" y2="6" />
  </svg>
);

const NoteTabIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const CloseIcon = () => (
  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);
