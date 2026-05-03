import React, { useState, useRef, useEffect } from 'react';
import { useUIStore } from '../../../graph/store/ui-store';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useChatSession } from '../../hooks/useChatSession';
import { useInputHistory } from '../../hooks/useInputHistory';
import { ChatMessage } from './ChatMessage';
import { SessionPicker } from './SessionPicker';
import { PresetPicker } from './PresetPicker';
import { ContextChipBar } from './ContextChipBar';
import { NodeAutocomplete } from './NodeAutocomplete';
import { useChatContextStore } from '../../../graph/store/chat-context-store';

export function ChatBot() {
  const { chatOpen, chatDisplayMode, toggleChat, setChatDisplayMode } = useUIStore();
  const { messages, sendMessage, newSession, loadSession, currentSessionId, isProcessing, sessionReady } = useChatSession();
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const displayMode = useUIStore((s) => s.displayMode);
  const isSidePanel = displayMode === 'sidePanel';
  const history = useInputHistory();
  const clearAttached = useChatContextStore((s) => s.clear);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isProcessing) return;
    history.push(input.trim());
    const currentAttached = useChatContextStore.getState().attachedNodes;
    sendMessage(input.trim(), currentAttached.length > 0 ? currentAttached : undefined);
    setInput('');
    clearAttached();
  };

  const handleNodeLinkClick = (nodeId: string) => {
    const cb = useUIStore.getState().focusNodeCallback;
    if (cb) {
      cb(nodeId);
    } else {
      useGraphStore.getState().selectNode(nodeId);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      const prev = history.navigateUp(input);
      if (prev !== null) {
        e.preventDefault();
        setInput(prev);
      }
    } else if (e.key === 'ArrowDown') {
      const next = history.navigateDown();
      if (next !== null) {
        e.preventDefault();
        setInput(next);
      }
    }
  };

  const handleInputChange = (v: string) => {
    setInput(v);
    history.reset();
  };

  if (!chatOpen) {
    return (
      <button
        onClick={toggleChat}
        title="Ask your graph"
        className="fixed bottom-4 right-4 z-50 w-10 h-10 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full shadow-lg flex items-center justify-center transition-colors"
      >
        <ChatBubbleIcon />
      </button>
    );
  }

  const headerProps = {
    onClose: toggleChat,
    onNewSession: newSession,
    onLoadSession: loadSession,
    currentSessionId,
    chatDisplayMode,
    onToggleMode: () => setChatDisplayMode(chatDisplayMode === 'float' ? 'sidebar' : 'float'),
    sessionTitle: messages.length > 0 ? messages[0].content : null,
  };

  const inputProps = {
    input,
    setInput: handleInputChange,
    onSubmit: handleSubmit,
    isProcessing,
    onKeyDown: handleKeyDown,
  };

  // Sidebar mode: rendered inline by the layout, not fixed
  if (chatDisplayMode === 'sidebar') {
    return (
      <div className="flex flex-col h-full bg-zinc-900 border-l border-zinc-700">
        <ChatHeader {...headerProps} />
        <ChatMessages messages={messages} messagesEndRef={messagesEndRef} onNodeClick={handleNodeLinkClick} sessionReady={sessionReady} onSuggestionClick={setInput} />
        <ChatInput {...inputProps} />
      </div>
    );
  }

  // Float mode: fixed overlay
  return (
    <div
      className={`fixed bottom-4 right-4 z-50 flex flex-col bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl ${
        isSidePanel ? 'w-[calc(100vw-2rem)] h-[60vh]' : 'w-96 h-[500px]'
      }`}
    >
      <ChatHeader {...headerProps} />
      <ChatMessages messages={messages} messagesEndRef={messagesEndRef} onNodeClick={handleNodeLinkClick} sessionReady={sessionReady} onSuggestionClick={setInput} />
      <ChatInput {...inputProps} />
    </div>
  );
}

function ChatHeader({
  onClose,
  onNewSession,
  onLoadSession,
  currentSessionId,
  chatDisplayMode,
  onToggleMode,
  sessionTitle,
}: {
  onClose: () => void;
  onNewSession: () => void;
  onLoadSession: (sessionId: string) => void;
  currentSessionId: string | null;
  chatDisplayMode: 'float' | 'sidebar';
  onToggleMode: () => void;
  sessionTitle: string | null;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);

  const displayTitle = sessionTitle
    ? (sessionTitle.length > 30 ? sessionTitle.slice(0, 30) + '...' : sessionTitle)
    : 'New chat';

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700 shrink-0">
      <div className="relative flex items-center gap-1 min-w-0 flex-1">
        <button
          onClick={() => setPickerOpen(!pickerOpen)}
          className="flex items-center gap-1 min-w-0 text-sm font-medium text-zinc-200 hover:text-white transition-colors"
          title="Session history"
        >
          <span className="truncate">{displayTitle}</span>
          <ChevronIcon open={pickerOpen} />
        </button>
        {pickerOpen && (
          <SessionPicker
            currentSessionId={currentSessionId}
            onSelectSession={onLoadSession}
            onNewSession={onNewSession}
            onClose={() => setPickerOpen(false)}
          />
        )}
        <PresetPicker />
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        <button
          onClick={onToggleMode}
          title={chatDisplayMode === 'float' ? 'Dock as sidebar' : 'Float'}
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
        >
          {chatDisplayMode === 'float' ? <DockIcon /> : <UndockIcon />}
        </button>
        <button
          onClick={onClose}
          title="Close"
          className="p-1 text-zinc-400 hover:text-zinc-200 rounded hover:bg-zinc-700 transition-colors"
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}

interface QuickAction {
  label: string;
  prompt: string;
}

const QUICK_ACTIONS: QuickAction[] = [
  { label: 'Index my notes', prompt: 'Please index my notes folder now.' },
  { label: 'Find duplicates', prompt: 'Find potential duplicate entities in my graph.' },
  { label: 'What do I know about...', prompt: 'What do I know about ' },
  { label: 'Summarize recent pages', prompt: 'Summarize the pages I\'ve recently extracted.' },
  { label: 'Find connections', prompt: 'Find connections between ' },
];

function ChatMessages({
  messages,
  messagesEndRef,
  onNodeClick,
  sessionReady,
  onSuggestionClick,
}: {
  messages: ReturnType<typeof useChatSession>['messages'];
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  onNodeClick: (nodeId: string) => void;
  sessionReady: boolean;
  onSuggestionClick?: (text: string) => void;
}) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center min-h-0 gap-4 px-4">
        <p className="text-zinc-500 text-sm text-center">
          {sessionReady ? 'What would you like to know? Ask anything about your knowledge graph.' : 'Restoring session...'}
        </p>
        {sessionReady && onSuggestionClick && (
          <div className="flex flex-wrap gap-2 justify-center">
            {QUICK_ACTIONS.map((action) => (
              <button
                key={action.label}
                onClick={() => onSuggestionClick(action.prompt)}
                className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 text-zinc-400 rounded-full hover:border-indigo-500/50 hover:text-zinc-200 transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto min-h-0 p-3 space-y-4">
      {messages.map((msg) => (
        <ChatMessage key={msg.id} message={msg} onNodeClick={onNodeClick} />
      ))}
      <div ref={messagesEndRef} />
    </div>
  );
}

function ChatInput({
  input,
  setInput,
  onSubmit,
  isProcessing,
  onKeyDown,
}: {
  input: string;
  setInput: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  isProcessing: boolean;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteQuery, setAutocompleteQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const handleInputChange = (value: string) => {
    setInput(value);

    const atIdx = value.lastIndexOf('@');
    if (atIdx !== -1 && (atIdx === 0 || value[atIdx - 1] === ' ')) {
      const query = value.slice(atIdx + 1);
      if (!query.includes(' ')) {
        setAutocompleteQuery(query);
        setShowAutocomplete(true);
        return;
      }
    }
    setShowAutocomplete(false);
  };

  const handleAutocompleteSelect = () => {
    const atIdx = input.lastIndexOf('@');
    if (atIdx !== -1) {
      setInput(input.slice(0, atIdx));
    }
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleAutocompleteDismiss = () => {
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleKeyDownWrapped = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (showAutocomplete && (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === 'Escape')) {
      return;
    }
    onKeyDown(e);
  };

  return (
    <div className="shrink-0 border-t border-zinc-700">
      <ContextChipBar />
      <form ref={formRef} onSubmit={onSubmit} className="relative flex gap-2 p-3">
        {showAutocomplete && (
          <NodeAutocomplete
            query={autocompleteQuery}
            onSelect={handleAutocompleteSelect}
            onDismiss={handleAutocompleteDismiss}
          />
        )}
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDownWrapped}
          placeholder="Ask about your knowledge graph... (@ to mention nodes)"
          className="flex-1 bg-zinc-800 text-sm text-zinc-100 px-3 py-1.5 rounded border border-zinc-700 focus:border-indigo-500 focus:outline-none"
          disabled={isProcessing}
        />
        <button
          type="submit"
          disabled={isProcessing || !input.trim()}
          className="bg-indigo-600 text-white text-sm px-3 py-1.5 rounded hover:bg-indigo-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? '...' : 'Ask'}
        </button>
      </form>
    </div>
  );
}

// Icons
const ChatBubbleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z" />
  </svg>
);

const DockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M15 3v18" />
  </svg>
);

const UndockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <rect x="6" y="6" width="14" height="14" rx="2" /><path d="M6 18 4 20" /><path d="M4 14v6h6" />
  </svg>
);

const ChevronIcon = ({ open }: { open: boolean }) => (
  <svg
    width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"
    className="flex-shrink-0 transition-transform"
    style={{ transform: open ? 'rotate(180deg)' : 'rotate(0deg)' }}
  >
    <path d="m6 9 6 6 6-6" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
  </svg>
);
