import { useUIStore } from '../../../graph/store/ui-store';
import { useReadingListStore } from '../../../graph/store/reading-list-store';

// ---------------------------------------------------------------------------
// SVG Icons (14x14, stroke-based)
// ---------------------------------------------------------------------------

const ExplorerIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

const ChatIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
  </svg>
);

const GraphIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3"/>
    <circle cx="18" cy="18" r="3"/>
    <circle cx="18" cy="6" r="3"/>
    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5"/>
    <line x1="8.5" y1="6" x2="15" y2="6"/>
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

const InboxIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/>
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>
  </svg>
);

const NotesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/>
    <polyline points="14 2 14 8 20 8"/>
    <line x1="16" y1="13" x2="8" y2="13"/>
    <line x1="16" y1="17" x2="8" y2="17"/>
  </svg>
);

const IntelligenceIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
    <path d="M9 18h6"/>
    <path d="M10 22h4"/>
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

const ExtractIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/>
  </svg>
);

const QueryIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
  </svg>
);

// ---------------------------------------------------------------------------
// Inbox badge
// ---------------------------------------------------------------------------

function InboxBadge() {
  const count = useReadingListStore((s) =>
    Object.values(s.items).filter((i) => i.status === 'ready').length,
  );
  if (count === 0) return null;
  return (
    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center rounded-full bg-emerald-500 text-[9px] font-bold text-white px-0.5">
      {count > 99 ? '99+' : count}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Divider
// ---------------------------------------------------------------------------

const Divider = () => <div className="w-5 h-px bg-zinc-700 my-1" />;

// ---------------------------------------------------------------------------
// ActivityBar
// ---------------------------------------------------------------------------

export function ActivityBar() {
  const leftPanel = useUIStore((s) => s.leftPanel);
  const setLeftPanel = useUIStore((s) => s.setLeftPanel);
  const openContentTab = useUIStore((s) => s.openContentTab);
  const contentColumns = useUIStore((s) => s.contentColumns);

  const isTabActive = (kind: string) =>
    contentColumns.some((col) => {
      const tab = col.tabs.find((t) => t.id === col.activeTabId);
      return tab?.type.kind === kind;
    });

  const btn = (active: boolean) =>
    `relative p-1.5 rounded transition-colors ${
      active
        ? 'bg-indigo-600 text-white'
        : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
    }`;

  return (
    <div className="w-10 shrink-0 flex flex-col items-center pt-2 gap-1 bg-zinc-800 border-r border-zinc-700">
      {/* ---- Library group (sidebar panels) ---- */}
      <button
        onClick={() => setLeftPanel('explorer')}
        className={btn(leftPanel === 'explorer')}
        title="Explorer"
      >
        <ExplorerIcon />
      </button>
      <button
        onClick={() => setLeftPanel('chats')}
        className={btn(leftPanel === 'chats')}
        title="Chat History"
      >
        <ChatIcon />
      </button>

      <Divider />

      {/* ---- Workspace group (content tabs) ---- */}
      <button
        onClick={() => openContentTab({ kind: 'graph' }, 'Graph')}
        className={btn(isTabActive('graph'))}
        title="Graph"
      >
        <GraphIcon />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'agents' }, 'Agents')}
        className={btn(isTabActive('agents'))}
        title="Agents"
      >
        <AgentsIcon />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'readingList' }, 'Inbox')}
        className={btn(isTabActive('readingList'))}
        title="Inbox"
      >
        <InboxIcon />
        <InboxBadge />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'notesBrowser' }, 'Notes')}
        className={btn(isTabActive('notesBrowser'))}
        title="Notes"
      >
        <NotesIcon />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'intelligence' }, 'Intelligence')}
        className={btn(isTabActive('intelligence'))}
        title="Intelligence"
      >
        <IntelligenceIcon />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'artifactBrowser' }, 'Artifacts')}
        className={btn(isTabActive('artifactBrowser'))}
        title="Artifacts"
      >
        <ArtifactsIcon />
      </button>

      <Divider />

      {/* ---- Tools group (content tabs) ---- */}
      <button
        onClick={() => openContentTab({ kind: 'extractionReview' }, 'Extract')}
        className={btn(isTabActive('extractionReview'))}
        title="Extract"
      >
        <ExtractIcon />
      </button>
      <button
        onClick={() => openContentTab({ kind: 'query' }, 'Query')}
        className={btn(isTabActive('query'))}
        title="Query"
      >
        <QueryIcon />
      </button>
    </div>
  );
}
