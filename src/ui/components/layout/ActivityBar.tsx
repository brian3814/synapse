import { useUIStore, type LeftPanel } from '../../../graph/store/ui-store';
import { useEntitySyncStore } from '../../../graph/store/entity-sync-store';

interface ActivityBarItem {
  panel: LeftPanel;
  title: string;
  icon: React.ReactNode;
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

const AgentsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 8V4H8"/>
    <rect width="16" height="12" x="4" y="8" rx="2"/>
    <path d="M2 14h2"/>
    <path d="M20 14h2"/>
    <path d="M15 13v2"/>
    <path d="M9 13v2"/>
  </svg>
);

const ArtifactsIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const SyncIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M2.5 22v-6h6"/>
    <path d="M2.5 11.5a10 10 0 0 1 18.8-4.3M21.5 12.5a10 10 0 0 1-18.8 4.2"/>
  </svg>
);

function SyncBadge() {
  const count = useEntitySyncStore((s) => s.notifications.filter((n) => !n.dismissed).length);
  if (count === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white px-0.5">
      {count > 99 ? '99+' : count}
    </span>
  );
}

const ITEMS: ActivityBarItem[] = [
  { panel: 'explorer', title: 'Explorer', icon: <FolderIcon /> },
  { panel: 'agents', title: 'Agents', icon: <AgentsIcon /> },
  { panel: 'artifacts' as const, title: 'Artifacts', icon: <ArtifactsIcon /> },
  { panel: 'sync', title: 'Sync', icon: <SyncIcon /> },
];

export function ActivityBar() {
  const leftPanel = useUIStore((s) => s.leftPanel);
  const setLeftPanel = useUIStore((s) => s.setLeftPanel);

  return (
    <div className="w-8 shrink-0 flex flex-col items-center pt-2 gap-1 bg-zinc-800 border-r border-zinc-700">
      {ITEMS.map((item) => (
        <button
          key={item.panel}
          onClick={() => setLeftPanel(item.panel)}
          className={`relative p-1.5 rounded transition-colors ${
            leftPanel === item.panel
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={leftPanel === item.panel ? `Close ${item.title}` : `Open ${item.title}`}
        >
          {item.icon}
          {item.panel === 'sync' && <SyncBadge />}
        </button>
      ))}
    </div>
  );
}
