import { useCallback, useEffect, useRef, useState } from 'react';
import { platformId, vaultWorkspace } from '@platform';
import type { RecentVault, VaultStatus } from '@platform/vault-workspace';

declare const window: Window & {
  electronIPC?: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  };
};

export function VaultSwitcher() {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [recentVaults, setRecentVaults] = useState<RecentVault[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (platformId !== 'electron') return;
    vaultWorkspace.getStatus().then(setStatus);
    vaultWorkspace.getRecent().then(setRecentVaults);
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const openInNewWindow = useCallback(async (vaultPath: string) => {
    setOpen(false);
    // Open a new Electron window for the selected vault
    window.electronIPC?.invoke('vault-workspace:open-new-window', vaultPath);
  }, []);

  const handleCreate = useCallback(async () => {
    setOpen(false);
    window.electronIPC?.invoke('vault-workspace:pick-create-new-window');
  }, []);

  const handleOpen = useCallback(async () => {
    setOpen(false);
    window.electronIPC?.invoke('vault-workspace:pick-open-new-window');
  }, []);

  if (platformId !== 'electron' || !status?.open) return null;

  const otherVaults = recentVaults.filter((v) => v.path !== status.path);

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-sm text-zinc-300 hover:bg-zinc-700 transition-colors max-w-[160px]"
        title={status.path}
      >
        <VaultIcon />
        <span className="truncate">{status.name}</span>
        <ChevronIcon open={open} />
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl z-50 overflow-hidden">
          {otherVaults.length > 0 && (
            <div className="py-1">
              <p className="px-3 py-1 text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Switch Vault</p>
              {otherVaults.map((v) => (
                <button
                  key={v.path}
                  onClick={() => openInNewWindow(v.path)}
                  className="w-full text-left px-3 py-1.5 hover:bg-zinc-700 transition-colors"
                >
                  <span className="text-sm text-zinc-200 block truncate">{v.name}</span>
                  <span className="text-[10px] text-zinc-500 block truncate">{v.path}</span>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-zinc-700 py-1">
            <button
              onClick={handleOpen}
              className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-2"
            >
              <FolderIcon />
              Open Vault
            </button>
            <button
              onClick={handleCreate}
              className="w-full text-left px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700 transition-colors flex items-center gap-2"
            >
              <PlusIcon />
              Create New Vault
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const VaultIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.93a2 2 0 0 1-1.66-.9l-.82-1.2A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/>
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
    className={`transition-transform ${open ? 'rotate-180' : ''}`}>
    <polyline points="6 9 12 15 18 9"/>
  </svg>
);

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>
  </svg>
);

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
  </svg>
);
