import { useCallback, useRef } from 'react';
import { useUIStore } from '../../../graph/store/ui-store';
import { ActivityBar } from './ActivityBar';
import { VaultDrawer } from './VaultDrawer';
import { ChatHistoryPanel } from '../chat/ChatHistoryPanel';

interface LeftSidebarProps {
  vaultPath: string | null;
  onOpenFile: (path: string, fileType: string) => void;
}

export function LeftSidebar({ vaultPath, onOpenFile }: LeftSidebarProps) {
  const leftPanel = useUIStore((s) => s.leftPanel);
  const width = useUIStore((s) => s.leftPanelWidth);
  const setWidth = useUIStore((s) => s.setLeftPanelWidth);

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
      <ActivityBar />
      {leftPanel !== 'none' && (
        <>
          <div
            style={{ width }}
            className="shrink-0 flex flex-col min-h-0 bg-zinc-850 border-r border-zinc-700 overflow-y-auto"
          >
            {leftPanel === 'explorer' && vaultPath && (
              <VaultDrawer rootPath={vaultPath} onOpenFile={onOpenFile} />
            )}
            {leftPanel === 'chats' && <ChatHistoryPanel />}
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
