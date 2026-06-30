import { useState, useEffect, useCallback, useRef } from 'react';
import { chat } from '../../../db/client/db-client';
import { useUIStore } from '../../../graph/store/ui-store';

interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  last_active_at: string;
  status: string;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr + 'Z').getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

function dateGroup(dateStr: string): string {
  const date = new Date(dateStr + 'Z');
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);
  const weekStart = new Date(todayStart.getTime() - 6 * 86400000);
  if (date >= todayStart) return 'Today';
  if (date >= yesterdayStart) return 'Yesterday';
  if (date >= weekStart) return 'This Week';
  return 'Older';
}

const GROUP_ORDER = ['Today', 'Yesterday', 'This Week', 'Older'];

export function ChatHistoryPanel() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameRef = useRef<HTMLInputElement>(null);

  const chatOpen = useUIStore((s) => s.chatOpen);
  const chatSessionVersion = useUIStore((s) => s.chatSessionVersion);
  const pendingChatSessionId = useUIStore((s) => s.pendingChatSessionId);

  const loadSessions = useCallback(() => {
    chat.getAllSessions()
      .then((s: ChatSession[]) => { setSessions(s); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // Refresh when chat closes or when a session is created/updated
  useEffect(() => {
    if (!chatOpen) loadSessions();
  }, [chatOpen, loadSessions]);

  useEffect(() => {
    loadSessions();
  }, [chatSessionVersion, loadSessions]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpenId) return;
    const handler = () => setMenuOpenId(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [menuOpenId]);

  // Focus rename input
  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  const handleSelectSession = (sessionId: string) => {
    if (renamingId) return;
    useUIStore.getState().setPendingChatSessionId(sessionId);
    useUIStore.getState().setChatOpen(true);
    useUIStore.getState().setChatDisplayMode('sidebar');
  };

  const handleNewSession = () => {
    useUIStore.getState().setPendingChatSessionId(null);
    useUIStore.getState().setChatOpen(true);
    useUIStore.getState().setChatDisplayMode('sidebar');
  };

  const handleDelete = async (sessionId: string) => {
    setMenuOpenId(null);
    await chat.deleteSession(sessionId).catch(() => {});
    setSessions(prev => prev.filter(s => s.id !== sessionId));
  };

  const startRename = (session: ChatSession) => {
    setMenuOpenId(null);
    setRenamingId(session.id);
    setRenameValue(session.title || '');
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await chat.updateSessionTitle(renamingId, renameValue.trim()).catch(() => {});
    setSessions(prev => prev.map(s =>
      s.id === renamingId ? { ...s, title: renameValue.trim() } : s
    ));
    setRenamingId(null);
  };

  const grouped = new Map<string, ChatSession[]>();
  for (const s of sessions) {
    const group = dateGroup(s.last_active_at);
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group)!.push(s);
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-700">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Chat History</span>
        <button onClick={handleNewSession} className="text-xs text-indigo-400 hover:text-indigo-300">+ New</button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && <p className="text-xs text-zinc-600 text-center py-6">Loading...</p>}

        {!loading && sessions.length === 0 && (
          <div className="text-center py-8 px-3">
            <p className="text-xs text-zinc-600">No conversations yet</p>
            <button onClick={handleNewSession} className="text-xs text-indigo-400 hover:text-indigo-300 mt-2">Start a new chat</button>
          </div>
        )}

        {GROUP_ORDER.map(group => {
          const items = grouped.get(group);
          if (!items || items.length === 0) return null;
          return (
            <div key={group}>
              <div className="text-[10px] text-zinc-600 font-medium px-3 py-1.5 mt-1">{group}</div>
              {items.map(session => (
                <div
                  key={session.id}
                  onClick={() => handleSelectSession(session.id)}
                  className={`relative w-full text-left flex items-start gap-2 px-3 py-2 transition-colors group cursor-pointer ${
                    session.id === pendingChatSessionId
                      ? 'bg-zinc-800 border-l-2 border-l-indigo-500'
                      : 'hover:bg-zinc-800/50 border-l-2 border-l-transparent'
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-zinc-600 mt-0.5 shrink-0">
                    <path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/>
                  </svg>
                  <div className="flex-1 min-w-0">
                    {renamingId === session.id ? (
                      <input
                        ref={renameRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={commitRename}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitRename();
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full text-xs text-zinc-200 bg-zinc-800 border border-indigo-500 rounded px-1.5 py-0.5 outline-none"
                      />
                    ) : (
                      <div className="text-xs text-zinc-300 truncate">{session.title || 'New chat'}</div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-zinc-600">{timeAgo(session.last_active_at)}</span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setMenuOpenId(menuOpenId === session.id ? null : session.id); }}
                      className="p-0.5 rounded text-zinc-700 hover:text-zinc-400 opacity-0 group-hover:opacity-100 transition-opacity"
                      title="Options"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
                      </svg>
                    </button>
                  </div>

                  {menuOpenId === session.id && (
                    <div
                      className="absolute right-2 top-8 bg-zinc-800 border border-zinc-700 rounded-md shadow-xl z-50 overflow-hidden"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => startRename(session)}
                        className="w-full text-left px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700 flex items-center gap-2"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                        Rename
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="w-full text-left px-3 py-1.5 text-xs text-red-400 hover:bg-zinc-700 flex items-center gap-2"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
