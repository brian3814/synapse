import { useCallback, useRef, useMemo, useState, useEffect } from 'react';
import { DragDropProvider, DragOverlay } from '@dnd-kit/react';
import { isSortable } from '@dnd-kit/react/sortable';
import { Header } from '../components/Header';
import { KnowledgeGraph } from '../components/graph/KnowledgeGraph';
import { ActivePanel } from '../components/ActivePanel';
import { ChatBot } from '../components/chat/ChatBot';
import { ResizeHandle } from '../components/ResizeHandle';
import { ColumnResizeHandle } from '../components/ColumnResizeHandle';
import { ContentTabBar } from '../components/ContentTabBar';
import { ColumnDropZone } from '../components/ColumnDropZone';
import { NoteEditor } from '../components/notes/NoteEditor';
import { ExtractionReviewTab } from '../components/llm/ExtractionReviewTab';
import { LeftSidebar } from '../components/layout/LeftSidebar';
import { ViewerTab } from '../components/tabs/ViewerTab';
import { useUIStore } from '../../graph/store/ui-store';
import { vaultWorkspace } from '@platform';
import type { ContentColumn } from '../../graph/store/ui-store';
import type { IngestionSource, ProcessingMode } from '../../ingestion/types';

interface TabLayoutProps {
  onIngest?: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function TabLayout({ onIngest }: TabLayoutProps) {
  const activePanel = useUIStore((s) => s.activePanel);
  const chatOpen = useUIStore((s) => s.chatOpen);
  const chatDisplayMode = useUIStore((s) => s.chatDisplayMode);
  const panelWidth = useUIStore((s) => s.panelWidth);
  const chatSidebarWidth = useUIStore((s) => s.chatSidebarWidth);
  const setPanelWidth = useUIStore((s) => s.setPanelWidth);
  const setChatSidebarWidth = useUIStore((s) => s.setChatSidebarWidth);
  const contentColumns = useUIStore((s) => s.contentColumns);
  const activeColumnId = useUIStore((s) => s.activeColumnId);
  const reorderContentTabs = useUIStore((s) => s.reorderContentTabs);
  const setColumnFlex = useUIStore((s) => s.setColumnFlex);
  const showChatSidebar = chatOpen && chatDisplayMode === 'sidebar';

  const [vaultPath, setVaultPath] = useState<string | null>(null);

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      if (status.open && status.path) setVaultPath(status.path);
    });
  }, []);

  const handleOpenFile = useCallback((filePath: string, fileType: string) => {
    const fileName = filePath.split('/').pop() ?? filePath;
    if (fileType === 'note' && vaultPath) {
      // Only match notes in the vault's own notes/ directory, not /notes/ anywhere in the path
      const notesPrefix = `${vaultPath}/notes/`;
      if (filePath.startsWith(notesPrefix) && filePath.endsWith('.md')) {
        const noteId = filePath.slice(notesPrefix.length, -3);
        useUIStore.getState().openContentTab({ kind: 'noteEditor', noteId }, fileName);
        return;
      }
    }
    if (fileType === 'note' || fileType === 'image' || fileType === 'pdf') {
      useUIStore.getState().openContentTab({ kind: 'viewer', filePath }, fileName);
    } else {
      (window as any).electronIPC.invoke('vault-explorer:open-external', filePath);
    }
  }, [vaultPath]);

  const snapshot = useRef(contentColumns);
  const columnsContainerRef = useRef<HTMLDivElement | null>(null);
  const totalFlex = useMemo(() => contentColumns.reduce((sum, c) => sum + c.flex, 0), [contentColumns]);

  const handleColumnResize = useCallback((leftId: string, leftFlex: number, rightId: string, rightFlex: number) => {
    setColumnFlex(leftId, leftFlex);
    setColumnFlex(rightId, rightFlex);
  }, [setColumnFlex]);

  const onPanelResize = useCallback((delta: number) => {
    setPanelWidth(panelWidth + delta);
  }, [panelWidth, setPanelWidth]);

  const onChatResize = useCallback((delta: number) => {
    setChatSidebarWidth(chatSidebarWidth + delta);
  }, [chatSidebarWidth, setChatSidebarWidth]);

  const handleDragStart = useCallback(() => {
    snapshot.current = useUIStore.getState().contentColumns;
  }, []);

  const handleDragEnd = useCallback((event: any) => {
    if (event.canceled) {
      useUIStore.setState({ contentColumns: snapshot.current });
      return;
    }

    const { source, target } = event.operation;

    if (target?.type === 'column-gap') {
      const tabId = source?.id as string;
      const columnIndex = target.data?.columnIndex as number;
      if (tabId && columnIndex != null) {
        useUIStore.getState().insertColumnAt(tabId, columnIndex);
      }
      return;
    }

    if (!isSortable(source)) return;
    const { initialIndex, index, initialGroup, group } = source;
    if (initialGroup == null || group == null) return;
    if (initialGroup === group && initialIndex === index) return;
    reorderContentTabs(
      initialGroup as string,
      group as string,
      initialIndex,
      index
    );
  }, [reorderContentTabs]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      <Header onIngest={onIngest} />
      <DragDropProvider onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="flex-1 flex overflow-hidden min-h-0" ref={columnsContainerRef}>
          <LeftSidebar vaultPath={vaultPath} onOpenFile={handleOpenFile} />
          {contentColumns.map((col, i) => (
            <ColumnWithDropZones
              key={col.id}
              column={col}
              index={i}
              isActive={col.id === activeColumnId}
              isFirst={i === 0}
              isLast={i === contentColumns.length - 1}
              prevColumn={i > 0 ? contentColumns[i - 1] : null}
              totalFlex={totalFlex}
              containerRef={columnsContainerRef}
              onColumnResize={handleColumnResize}
            />
          ))}
          {activePanel !== 'none' && (
            <>
              <ResizeHandle onResize={onPanelResize} />
              <div style={{ width: panelWidth }} className="shrink-0 overflow-y-auto">
                <ActivePanel />
              </div>
            </>
          )}
          {showChatSidebar && (
            <>
              <ResizeHandle onResize={onChatResize} />
              <div style={{ width: chatSidebarWidth }} className="shrink-0 min-h-0">
                <ChatBot />
              </div>
            </>
          )}
        </div>
        <DragOverlay>
          {(source) => {
            const tab = findTabById(contentColumns, source.id as string);
            if (!tab) return null;
            return (
              <div className="flex items-center gap-1.5 px-3 h-7 text-[11px] whitespace-nowrap bg-indigo-900/80 text-zinc-100 border border-indigo-500 rounded shadow-lg backdrop-blur-sm">
                {tab.type.kind === 'graph' ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <circle cx="6" cy="6" r="3" /><circle cx="18" cy="18" r="3" /><circle cx="18" cy="6" r="3" />
                    <line x1="8.5" y1="7.5" x2="15.5" y2="16.5" /><line x1="15.5" y1="6" x2="8.5" y2="6" />
                  </svg>
                ) : (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                )}
                <span>{tab.title}</span>
              </div>
            );
          }}
        </DragOverlay>
      </DragDropProvider>
      {(!chatOpen || chatDisplayMode === 'float') && <ChatBot />}
    </div>
  );
}

function findTabById(columns: ContentColumn[], id: string) {
  for (const col of columns) {
    const tab = col.tabs.find(t => t.id === id);
    if (tab) return tab;
  }
  return null;
}

function ColumnWithDropZones({
  column,
  index,
  isActive,
  isFirst,
  isLast,
  prevColumn,
  totalFlex,
  containerRef,
  onColumnResize,
}: {
  column: ContentColumn;
  index: number;
  isActive: boolean;
  isFirst: boolean;
  isLast: boolean;
  prevColumn: ContentColumn | null;
  totalFlex: number;
  containerRef: React.RefObject<HTMLElement | null>;
  onColumnResize: (leftId: string, leftFlex: number, rightId: string, rightFlex: number) => void;
}) {
  return (
    <>
      {isFirst && <ColumnDropZone id={`gap-before-0`} columnIndex={0} />}
      {!isFirst && prevColumn && (
        <>
          <ColumnResizeHandle
            leftColumnId={prevColumn.id}
            rightColumnId={column.id}
            leftFlex={prevColumn.flex}
            rightFlex={column.flex}
            totalFlex={totalFlex}
            containerRef={containerRef}
            onResize={onColumnResize}
          />
          <ColumnDropZone id={`gap-before-${index}`} columnIndex={index} />
        </>
      )}
      <div
        style={{ flex: column.flex }}
        className={`min-w-0 min-h-0 flex flex-col ${isActive ? '' : 'opacity-90'}`}
        onClick={() => useUIStore.getState().activeColumnId !== column.id &&
          useUIStore.setState({ activeColumnId: column.id })}
      >
        <ContentTabBar
          columnId={column.id}
          tabs={column.tabs}
          activeTabId={column.activeTabId}
          isActiveColumn={isActive}
        />
        <div className="flex-1 min-h-0 relative">
          {column.tabs.map((tab) => (
            <div
              key={tab.id}
              className={`absolute inset-0 ${column.activeTabId === tab.id ? '' : 'hidden'}`}
            >
              {tab.type.kind === 'graph' ? (
                <KnowledgeGraph />
              ) : tab.type.kind === 'extractionReview' ? (
                <ExtractionReviewTab />
              ) : tab.type.kind === 'viewer' ? (
                <ViewerTab filePath={tab.type.filePath} />
              ) : (
                <div className="h-full overflow-y-auto bg-zinc-900">
                  <NoteEditor nodeId={tab.type.noteId} isTab />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {isLast && <ColumnDropZone id={`gap-after-${index}`} columnIndex={index + 1} />}
    </>
  );
}
