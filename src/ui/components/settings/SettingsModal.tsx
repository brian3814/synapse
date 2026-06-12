import { useEffect, useRef, useState } from 'react';
import { useUIStore } from '../../../graph/store/ui-store';
import { SettingsPanel } from './SettingsPanel';

export type SettingsTab = 'general' | 'model' | 'billing' | 'about';

const TABS: Array<{ id: SettingsTab; label: string }> = [
  { id: 'general', label: 'General' },
  { id: 'model', label: 'Model' },
  { id: 'billing', label: 'Billing' },
  { id: 'about', label: 'About' },
];

export function SettingsModal() {
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const backdropRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  useEffect(() => {
    if (!settingsOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSettingsOpen(false);
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [settingsOpen, setSettingsOpen]);

  if (!settingsOpen) return null;

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => {
        if (e.target === backdropRef.current) setSettingsOpen(false);
      }}
    >
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[60vw] h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-4 shrink-0 border-b border-zinc-700" style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}>
          <h2 className="text-sm font-semibold text-zinc-100">Settings</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <nav style={{ width: 160, flexShrink: 0, borderRight: '1px solid #3f3f46', padding: '0.75rem 0.5rem' }}>
            <div className="space-y-0.5">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                    activeTab === tab.id
                      ? 'bg-zinc-800 text-zinc-100'
                      : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </nav>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto', overflowX: 'hidden' }}>
            <SettingsPanel activeTab={activeTab} />
          </div>
        </div>
      </div>
    </div>
  );
}
