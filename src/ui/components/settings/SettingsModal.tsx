import React, { useEffect, useRef } from 'react';
import { useUIStore } from '../../../graph/store/ui-store';
import { SettingsPanel } from './SettingsPanel';

export function SettingsModal() {
  const settingsOpen = useUIStore((s) => s.settingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const backdropRef = useRef<HTMLDivElement>(null);

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
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-[60vw] max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between px-4 bg-zinc-900 border-b border-zinc-700" style={{ paddingTop: '0.75rem', paddingBottom: '0.75rem' }}>
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
        <SettingsPanel />
      </div>
    </div>
  );
}
