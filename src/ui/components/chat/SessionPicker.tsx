import { useState, useEffect, useRef } from 'react';
import { chat } from '../../../db/client/db-client';

interface Props {
  currentSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  onNewSession: () => void;
  onClose: () => void;
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr + 'Z').getTime();
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}

export function SessionPicker({ currentSessionId, onSelectSession, onNewSession, onClose }: Props) {
  const [sessions, setSessions] = useState<any[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chat.getAllSessions().then(setSessions).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute left-0 top-full z-50 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl"
      style={{ width: '280px', maxHeight: '320px', marginTop: '4px' }}
    >
      {/* New chat button */}
      <button
        onClick={() => { onNewSession(); onClose(); }}
        className="w-full text-left px-3 py-2 text-xs text-indigo-400 hover:bg-zinc-700/50 transition-colors flex items-center gap-2 border-b border-zinc-700/50"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        New chat
      </button>

      {/* Session list */}
      <div className="overflow-y-auto" style={{ maxHeight: '272px' }}>
        {sessions.length === 0 ? (
          <div className="px-3 py-3 text-xs text-zinc-500 text-center">No past sessions</div>
        ) : (
          sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => { onSelectSession(s.id); onClose(); }}
              className={`w-full text-left px-3 py-2 text-xs transition-colors flex items-center justify-between gap-2 ${
                s.id === currentSessionId
                  ? 'bg-indigo-600/10 text-zinc-200'
                  : 'text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200'
              }`}
            >
              <span className="truncate flex-1 min-w-0">
                {s.title || 'Untitled'}
              </span>
              <span className="text-zinc-600 flex-shrink-0" style={{ fontSize: '10px' }}>
                {timeAgo(s.last_active_at)}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
