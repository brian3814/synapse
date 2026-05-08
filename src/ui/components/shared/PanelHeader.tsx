import { useUIStore } from '../../../graph/store/ui-store';

interface PanelHeaderProps {
  title: string;
  children?: React.ReactNode;
}

export function PanelHeader({ title, children }: PanelHeaderProps) {
  const setActivePanel = useUIStore((s) => s.setActivePanel);

  return (
    <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold text-zinc-100">{title}</h3>
      <div className="flex items-center gap-1">
        {children}
        <button
          onClick={() => setActivePanel('none')}
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
          title="Close panel"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
