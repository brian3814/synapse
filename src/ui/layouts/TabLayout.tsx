import { useCallback } from 'react';
import { Header } from '../components/Header';
import { KnowledgeGraph } from '../components/graph/KnowledgeGraph';
import { ActivePanel } from '../components/ActivePanel';
import { ChatBot } from '../components/chat/ChatBot';
import { ResizeHandle } from '../components/ResizeHandle';
import { ContentTabBar } from '../components/ContentTabBar';
import { NoteEditor } from '../components/notes/NoteEditor';
import { useUIStore } from '../../graph/store/ui-store';
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
  const contentTabs = useUIStore((s) => s.contentTabs);
  const activeContentTabId = useUIStore((s) => s.activeContentTabId);
  const showChatSidebar = chatOpen && chatDisplayMode === 'sidebar';

  const onPanelResize = useCallback((delta: number) => {
    setPanelWidth(panelWidth + delta);
  }, [panelWidth, setPanelWidth]);

  const onChatResize = useCallback((delta: number) => {
    setChatSidebarWidth(chatSidebarWidth + delta);
  }, [chatSidebarWidth, setChatSidebarWidth]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      <Header onIngest={onIngest} />
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Main content area — tabbed (graph + note editors) */}
        <div className="flex-1 min-h-0 flex flex-col">
          <ContentTabBar />
          <div className="flex-1 min-h-0 relative">
            {contentTabs.map((tab) => (
              <div
                key={tab.id}
                className={`absolute inset-0 ${activeContentTabId === tab.id ? '' : 'hidden'}`}
              >
                {tab.type.kind === 'graph' ? (
                  <KnowledgeGraph />
                ) : (
                  <div className="h-full overflow-y-auto bg-zinc-900">
                    <NoteEditor nodeId={tab.type.noteId} isTab />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
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
      {/* Float mode FAB / overlay */}
      {(!chatOpen || chatDisplayMode === 'float') && <ChatBot />}
    </div>
  );
}
