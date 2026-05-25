import { useCallback, useRef } from 'react';
import { VaultExplorer } from '../vault-explorer';
import { useUIStore } from '../../../graph/store/ui-store';

interface VaultDrawerProps {
  rootPath: string;
  onOpenFile: (path: string, fileType: string) => void;
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  </svg>
);

export function VaultDrawer({ rootPath, onOpenFile }: VaultDrawerProps) {
  const isOpen = useUIStore((s) => s.vaultDrawerOpen);
  const width = useUIStore((s) => s.vaultDrawerWidth);
  const toggleDrawer = useUIStore((s) => s.toggleVaultDrawer);
  const setWidth = useUIStore((s) => s.setVaultDrawerWidth);

  const dragging = useRef(false);
  const lastX = useRef(0);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    lastX.current = e.clientX;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging.current) return;
    const delta = e.clientX - lastX.current;
    lastX.current = e.clientX;
    setWidth(width + delta);
  }, [width, setWidth]);

  const onPointerUp = useCallback(() => {
    dragging.current = false;
  }, []);

  return (
    <>
      {/* Icon rail — always visible */}
      <div className="w-8 shrink-0 flex flex-col items-center pt-2 bg-zinc-800 border-r border-zinc-700">
        <button
          onClick={toggleDrawer}
          className={`p-1.5 rounded transition-colors ${
            isOpen
              ? 'bg-indigo-600 text-white'
              : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
          }`}
          title={isOpen ? 'Close Explorer' : 'Open Explorer'}
        >
          <FolderIcon />
        </button>
      </div>

      {/* Drawer panel — only when open */}
      {isOpen && (
        <>
          <div
            style={{ width }}
            className="shrink-0 flex flex-col min-h-0 bg-zinc-850 border-r border-zinc-700"
          >
            <VaultExplorer rootPath={rootPath} onOpenFile={onOpenFile} />
          </div>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            className="w-1 shrink-0 cursor-col-resize bg-zinc-700 hover:bg-indigo-500 active:bg-indigo-400 transition-colors"
          />
        </>
      )}
    </>
  );
}
