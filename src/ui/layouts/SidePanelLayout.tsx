import { Header } from '../components/Header';
import { KnowledgeGraph } from '../components/graph/KnowledgeGraph';
import { ChatBot } from '../components/chat/ChatBot';
import { RelatedWidget } from '../components/RelatedWidget';
import { useUIStore } from '../../graph/store/ui-store';

export function SidePanelLayout() {
  const chatOpen = useUIStore((s) => s.chatOpen);
  const chatDisplayMode = useUIStore((s) => s.chatDisplayMode);
  const showChatSidebar = chatOpen && chatDisplayMode === 'sidebar';

  return (
    <div className="flex flex-col h-full bg-zinc-900 relative">
      <Header />
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {showChatSidebar ? (
          <div className="flex-1 min-h-0">
            <ChatBot />
          </div>
        ) : (
          <>
            <RelatedWidget />
            <div className="flex-1 min-h-0 relative">
              <KnowledgeGraph compact />
            </div>
          </>
        )}
      </div>
      {(!chatOpen || chatDisplayMode === 'float') && <ChatBot />}
    </div>
  );
}
