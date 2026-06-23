import React from 'react';
import { Header } from '../components/Header';
import { KnowledgeGraph } from '../components/graph/KnowledgeGraph';
import { ActivePanel } from '../components/ActivePanel';
import { ChatBot } from '../components/chat/ChatBot';
import { RelatedWidget } from '../components/RelatedWidget';
import { useUIStore } from '../../graph/store/ui-store';
import type { IngestionSource, ProcessingMode } from '../../ingestion/types';

interface SidePanelLayoutProps {
  onIngest?: (source: IngestionSource, mode: ProcessingMode) => void;
}

export function SidePanelLayout({ onIngest }: SidePanelLayoutProps) {
  const activePanel = useUIStore((s) => s.activePanel);
  const chatOpen = useUIStore((s) => s.chatOpen);
  const chatDisplayMode = useUIStore((s) => s.chatDisplayMode);
  const showChatSidebar = chatOpen && chatDisplayMode === 'sidebar';

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      <Header onIngest={onIngest} />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {showChatSidebar ? (
          <div className="flex-1 min-h-0">
            <ChatBot />
          </div>
        ) : (
          <>
            <RelatedWidget />
            <div className={`${activePanel === 'none' ? 'flex-1' : 'h-[45%]'} min-h-0 relative`}>
              <KnowledgeGraph compact />
            </div>
            {activePanel !== 'none' && (
              <div className="flex-1 min-h-0 border-t border-zinc-700 overflow-y-auto">
                <ActivePanel />
              </div>
            )}
          </>
        )}
      </div>
      {/* Float mode FAB / overlay */}
      {(!chatOpen || chatDisplayMode === 'float') && <ChatBot />}
    </div>
  );
}
