import { useState, useRef, useEffect, useMemo } from 'react';
import { useReadingListStore } from '../../../graph/store/reading-list-store';
import { SUPPORTED_FILE_EXTENSIONS } from '../../../shared/reading-list-types';

type ParsedUrl = {
  raw: string;
  normalized: string;
  domain: string;
  status: 'valid' | 'insecure' | 'duplicate' | 'invalid';
};

function parseUrls(text: string, existingUrls: Set<string>): ParsedUrl[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const seen = new Set<string>();
  const results: ParsedUrl[] = [];

  for (const raw of lines) {
    let normalized = raw;
    if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

    let domain = '';
    try {
      const u = new URL(normalized);
      domain = u.hostname.replace('www.', '');
    } catch {
      results.push({ raw, normalized, domain: '', status: 'invalid' });
      continue;
    }

    if (existingUrls.has(normalized) || seen.has(normalized)) {
      results.push({ raw, normalized, domain, status: 'duplicate' });
      continue;
    }

    seen.add(normalized);
    const isHttp = normalized.startsWith('http://');
    results.push({ raw, normalized, domain, status: isHttp ? 'insecure' : 'valid' });
  }

  return results;
}

const ACCEPT_EXTENSIONS = Array.from(SUPPORTED_FILE_EXTENSIONS).join(',');

interface AddResourceModalProps {
  onClose: () => void;
  onFilesSelected: (files: File[]) => void;
}

export function AddResourceModal({ onClose, onFilesSelected }: AddResourceModalProps) {
  const [tab, setTab] = useState<'urls' | 'files'>('urls');
  const [text, setText] = useState('');
  const backdropRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = useReadingListStore((s) => s.items);
  const addResource = useReadingListStore((s) => s.addResource);
  const fetchTitles = useReadingListStore((s) => s.fetchTitles);

  useEffect(() => {
    if (tab === 'urls') {
      textareaRef.current?.focus();
    }
  }, [tab]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const existingUrls = useMemo(() => new Set(Object.keys(items)), [items]);
  const parsed = useMemo(() => parseUrls(text, existingUrls), [text, existingUrls]);
  const addable = parsed.filter((p) => p.status === 'valid' || p.status === 'insecure');

  const handleAdd = async () => {
    if (addable.length === 0) return;
    const ids: string[] = [];
    for (const p of addable) {
      const domain = p.domain || p.normalized;
      await addResource({ kind: 'url', url: p.normalized }, domain);
      ids.push(p.normalized);
    }
    fetchTitles(ids);
    onClose();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    const supportedFiles = files.filter((f) => {
      const ext = '.' + f.name.split('.').pop()?.toLowerCase();
      return SUPPORTED_FILE_EXTENSIONS.has(ext);
    });
    if (supportedFiles.length > 0) {
      onFilesSelected(supportedFiles);
    }
    onClose();
  };

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl flex flex-col"
        style={{ width: 480, maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-700">
          <h2 className="text-sm font-semibold text-zinc-100">Add to Reading List</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-700">
          <button
            onClick={() => setTab('urls')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors relative ${
              tab === 'urls' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            URLs
            {tab === 'urls' && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-500 rounded-full" />
            )}
          </button>
          <button
            onClick={() => setTab('files')}
            className={`flex-1 px-4 py-2 text-xs font-medium transition-colors relative ${
              tab === 'files' ? 'text-zinc-100' : 'text-zinc-500 hover:text-zinc-300'
            }`}
          >
            Files
            {tab === 'files' && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-indigo-500 rounded-full" />
            )}
          </button>
        </div>

        {/* Body */}
        {tab === 'urls' ? (
          <>
            <div className="px-4 py-3 flex flex-col gap-3 overflow-y-auto">
              <p className="text-xs text-zinc-500">Paste one URL per line</p>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder={"https://example.com/article-one\nhttps://example.com/article-two"}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-md px-3 py-2 text-xs text-zinc-200 placeholder-zinc-600 font-mono outline-none focus:border-indigo-500 resize-y"
              />

              {/* Live preview */}
              {parsed.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {parsed.map((p, i) => (
                    <div
                      key={i}
                      className={`flex items-center gap-2 text-xs px-2 py-1.5 rounded ${
                        p.status === 'invalid' || p.status === 'duplicate'
                          ? 'text-zinc-500'
                          : 'text-zinc-300'
                      }`}
                    >
                      <StatusIcon status={p.status} />
                      <span className="truncate flex-1 min-w-0">
                        {p.domain || p.raw}
                      </span>
                      <StatusLabel status={p.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAdd}
                disabled={addable.length === 0}
                className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {addable.length === 0 ? 'Add URLs' : `Add ${addable.length} URL${addable.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="px-4 py-8 flex flex-col items-center gap-4">
              <p className="text-xs text-zinc-500 text-center">
                Select one or more files to add to your reading list.
              </p>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 text-xs bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors"
              >
                Choose Files...
              </button>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={ACCEPT_EXTENSIONS}
                className="hidden"
                onChange={handleFileChange}
              />
              <p className="text-[10px] text-zinc-600 text-center">
                Supported: {Array.from(SUPPORTED_FILE_EXTENSIONS).join(', ')}
              </p>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-zinc-700">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ParsedUrl['status'] }) {
  if (status === 'valid') {
    return <span className="w-2 h-2 rounded-full bg-emerald-500 flex-shrink-0" />;
  }
  if (status === 'insecure') {
    return (
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500 flex-shrink-0">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    );
  }
  if (status === 'duplicate') {
    return <span className="w-2 h-2 rounded-full bg-zinc-600 flex-shrink-0" />;
  }
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-400 flex-shrink-0">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

function StatusLabel({ status }: { status: ParsedUrl['status'] }) {
  if (status === 'insecure') {
    return <span className="text-amber-500 flex-shrink-0">insecure</span>;
  }
  if (status === 'duplicate') {
    return <span className="text-zinc-500 flex-shrink-0">already added</span>;
  }
  if (status === 'invalid') {
    return <span className="text-red-400 flex-shrink-0">invalid</span>;
  }
  return null;
}
