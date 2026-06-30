import { useState, useEffect, useCallback, useRef } from 'react';
import { useGraphStore } from '../../../graph/store/graph-store';
import { useArtifactStore } from '../../../graph/store/artifact-store';
import { dbExec, noteSearch, chat } from '../../../db/client/db-client';
import { notes, vault, vaultWorkspace, platformId } from '@platform';
import { createUICommandContext } from '../../../commands/create-context';
import * as memoryCommands from '../../../commands/memory-commands';
import {
  type CleanupCategory,
  type CategoryCounts,
  type CategoryStatus,
  ALL_CATEGORIES,
  buildSelectedSet,
  pathMatches,
  executeCleanup,
  formatFileSize,
} from './vault-cleanup-logic';

interface VaultCleanupModalProps {
  onClose: () => void;
}

type Step = 'confirm' | 'verify' | 'select';

const CATEGORY_META: Record<CleanupCategory, { label: string; icon: string }> = {
  graph: { label: 'Graph data', icon: '🔗' },
  chat: { label: 'Chat history', icon: '💬' },
  artifacts: { label: 'Artifacts', icon: '📄' },
  memories: { label: 'Memories', icon: '🧠' },
  notes: { label: 'Notes', icon: '📝' },
  entityFiles: { label: 'Entity files', icon: '📂' },
  vaultFiles: { label: 'Vault files', icon: '📁' },
};

function categoryCountLabel(category: CleanupCategory, counts: CategoryCounts): string {
  switch (category) {
    case 'graph': return `${counts.nodes} nodes, ${counts.edges} edges`;
    case 'chat': return `${counts.chatSessions} sessions`;
    case 'artifacts': return `${counts.artifacts} artifacts`;
    case 'memories': return `${counts.memories} memories`;
    case 'notes': return `${counts.notes} notes`;
    case 'entityFiles': {
      const { fileCount, bytes } = counts.entityFiles;
      return fileCount > 0 ? `${fileCount} files (${formatFileSize(bytes)})` : '0 files';
    }
    case 'vaultFiles': {
      const { fileCount, bytes } = counts.vaultFiles;
      return fileCount > 0 ? `${fileCount} files (${formatFileSize(bytes)})` : '0 files';
    }
  }
}

function categoryHasData(category: CleanupCategory, counts: CategoryCounts): boolean {
  switch (category) {
    case 'graph': return counts.nodes > 0 || counts.edges > 0;
    case 'chat': return counts.chatSessions > 0;
    case 'artifacts': return counts.artifacts > 0;
    case 'memories': return counts.memories > 0;
    case 'notes': return counts.notes > 0;
    case 'entityFiles': return counts.entityFiles.fileCount > 0;
    case 'vaultFiles': return counts.vaultFiles.fileCount > 0;
  }
}

export function VaultCleanupModal({ onClose }: VaultCleanupModalProps) {
  const [step, setStep] = useState<Step>('confirm');
  const [vaultPath, setVaultPath] = useState<string>('');
  const [typedPath, setTypedPath] = useState('');
  const [copied, setCopied] = useState(false);
  const [counts, setCounts] = useState<CategoryCounts | null>(null);
  const [selected, setSelected] = useState<Set<CleanupCategory>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState<Record<string, CategoryStatus>>({});
  const [errors, setErrors] = useState<Array<{ category: CleanupCategory; message: string }>>([]);
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    vaultWorkspace.getStatus().then((status) => {
      if (status.open && status.path) setVaultPath(status.path);
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function fetchCounts() {
      const nodeCount = useGraphStore.getState().nodes.length;
      const edgeCount = useGraphStore.getState().edges.length;

      const results = await Promise.allSettled([
        chat.getAllSessions().then((s: any[]) => s.length),
        useArtifactStore.getState().loadArtifacts().then(() => useArtifactStore.getState().artifacts.length),
        createUICommandContext().files.list('memory/').then((files: string[]) => files.filter(f => f.endsWith('.md') && f !== 'MEMORY.md').length).catch(() => 0),
        notes.list().then((ids: string[]) => ids.length),
        platformId === 'electron' ? (window as any).electronIPC.invoke('entity-files:usage') : Promise.resolve({ fileCount: 0, bytes: 0 }),
        vault.getStorageUsage(),
      ]);

      if (cancelled) return;

      const c: CategoryCounts = {
        nodes: nodeCount,
        edges: edgeCount,
        chatSessions: results[0].status === 'fulfilled' ? results[0].value : 0,
        artifacts: results[1].status === 'fulfilled' ? results[1].value : 0,
        memories: results[2].status === 'fulfilled' ? results[2].value : 0,
        notes: results[3].status === 'fulfilled' ? results[3].value : 0,
        entityFiles: results[4].status === 'fulfilled' ? results[4].value : { fileCount: 0, bytes: 0 },
        vaultFiles: results[5].status === 'fulfilled' ? results[5].value : { fileCount: 0, bytes: 0 },
      };
      setCounts(c);
      setSelected(buildSelectedSet(c));
    }
    fetchCounts();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (deleting) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, deleting]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(vaultPath).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [vaultPath]);

  const toggleCategory = useCallback((cat: CleanupCategory) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!counts) return;
    const withData = ALL_CATEGORIES.filter(c => categoryHasData(c, counts));
    const allSelected = withData.every(c => selected.has(c));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(withData));
    }
  }, [counts, selected]);

  const handleDelete = useCallback(async () => {
    if (!counts) return;
    setDeleting(true);
    setProgress({});
    setErrors([]);

    const selectedSnapshot = new Set(selected);

    const deleters: Record<CleanupCategory, () => Promise<void>> = {
      graph: async () => {
        if (selectedSnapshot.has('chat')) {
          await useGraphStore.getState().clearAll();
        } else {
          await dbExec('DELETE FROM edges');
          await dbExec('DELETE FROM nodes');
          useGraphStore.setState({
            nodes: [],
            edges: [],
            adjacency: new Map(),
            selectedNodeIds: new Set<string>(),
            selectedEdgeId: null,
          });
        }
      },
      chat: async () => {
        if (selectedSnapshot.has('graph')) return;
        await dbExec('DELETE FROM chat_messages');
        await dbExec('DELETE FROM chat_sessions');
      },
      artifacts: async () => {
        const { artifacts } = await import('@platform');
        const all = await artifacts.list();
        for (const a of all) await artifacts.delete(a.id);
        useArtifactStore.setState({ artifacts: [] });
      },
      memories: async () => {
        const ctx = createUICommandContext();
        const all = await memoryCommands.listMemories(ctx);
        for (const m of all) await memoryCommands.deleteMemory(ctx, m.filename);
      },
      notes: async () => {
        const noteIds = await notes.list();
        for (const id of noteIds) {
          await notes.remove(id);
          await noteSearch.delete(id).catch(() => {});
        }
      },
      entityFiles: async () => {
        if (platformId === 'electron') {
          await (window as any).electronIPC.invoke('entity-files:clear-all');
        }
      },
      vaultFiles: async () => {
        await (vault as any).clearAll?.();
      },
    };

    const result = await executeCleanup(
      selectedSnapshot,
      deleters,
      (category, status) => setProgress(prev => ({ ...prev, [category]: status })),
    );

    setErrors(result.errors);
    setDone(true);
    setDeleting(false);
  }, [counts, selected]);

  const isMatch = pathMatches(typedPath, vaultPath);

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === backdropRef.current && !deleting) onClose(); }}
    >
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-2xl w-full max-w-md mx-4">
        {step === 'confirm' && <ConfirmStep onContinue={() => setStep('verify')} onCancel={onClose} />}
        {step === 'verify' && (
          <VerifyStep
            vaultPath={vaultPath}
            typedPath={typedPath}
            onTypedPathChange={setTypedPath}
            isMatch={isMatch}
            copied={copied}
            onCopy={handleCopy}
            onContinue={() => setStep('select')}
            onBack={() => { setStep('confirm'); setTypedPath(''); }}
          />
        )}
        {step === 'select' && counts && (
          <SelectStep
            counts={counts}
            selected={selected}
            progress={progress}
            errors={errors}
            deleting={deleting}
            done={done}
            onToggle={toggleCategory}
            onToggleAll={toggleAll}
            onDelete={handleDelete}
            onBack={() => setStep('verify')}
            onClose={onClose}
          />
        )}
        {step === 'select' && !counts && (
          <div className="p-6 text-center">
            <p className="text-xs text-zinc-500">Loading data counts...</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ConfirmStep({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-red-900/30 flex items-center justify-center shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-400">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Clear Vault Data</h3>
          <p className="text-xs text-zinc-500 mt-0.5">Irreversible destructive action</p>
        </div>
      </div>
      <p className="text-xs text-zinc-400 leading-relaxed">
        This will permanently delete selected data from your vault. This action cannot be undone.
        You will be asked to verify your vault path and choose which data to delete.
      </p>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onContinue}
          className="flex-1 bg-red-600 text-white text-sm py-2 rounded-md hover:bg-red-500 transition-colors font-medium"
        >
          Continue
        </button>
        <button
          onClick={onCancel}
          className="flex-1 bg-zinc-700 text-zinc-300 text-sm py-2 rounded-md hover:bg-zinc-600 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function VerifyStep({
  vaultPath, typedPath, onTypedPathChange, isMatch, copied, onCopy, onContinue, onBack,
}: {
  vaultPath: string; typedPath: string; onTypedPathChange: (v: string) => void;
  isMatch: boolean; copied: boolean; onCopy: () => void; onContinue: () => void; onBack: () => void;
}) {
  return (
    <div className="p-6 space-y-4">
      <div>
        <h3 className="text-sm font-semibold text-zinc-100">Verify vault path</h3>
        <p className="text-xs text-zinc-500 mt-1">To confirm, type the vault path shown below:</p>
      </div>

      <div className="flex items-center gap-2 bg-zinc-800 border border-zinc-600 rounded-md px-3 py-2">
        <code className="flex-1 text-xs text-zinc-200 font-mono break-all select-all">{vaultPath}</code>
        <button
          onClick={onCopy}
          className="shrink-0 p-1 rounded text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 transition-colors"
          title="Copy path"
        >
          {copied ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
        </button>
      </div>

      <input
        type="text"
        value={typedPath}
        onChange={(e) => onTypedPathChange(e.target.value)}
        placeholder="Type the vault path here..."
        className={`w-full bg-zinc-800 border rounded-md px-3 py-2 text-xs font-mono text-zinc-100 outline-none placeholder-zinc-600 transition-colors ${
          typedPath.length === 0 ? 'border-zinc-600' : isMatch ? 'border-emerald-500' : 'border-zinc-600'
        }`}
        autoFocus
      />

      <div className="flex gap-2 pt-1">
        <button
          onClick={onBack}
          className="px-4 bg-zinc-700 text-zinc-300 text-sm py-2 rounded-md hover:bg-zinc-600 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onContinue}
          disabled={!isMatch}
          className="flex-1 bg-red-600 text-white text-sm py-2 rounded-md hover:bg-red-500 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function SelectStep({
  counts, selected, progress, errors, deleting, done,
  onToggle, onToggleAll, onDelete, onBack, onClose,
}: {
  counts: CategoryCounts;
  selected: Set<CleanupCategory>;
  progress: Record<string, CategoryStatus>;
  errors: Array<{ category: CleanupCategory; message: string }>;
  deleting: boolean;
  done: boolean;
  onToggle: (cat: CleanupCategory) => void;
  onToggleAll: () => void;
  onDelete: () => void;
  onBack: () => void;
  onClose: () => void;
}) {
  const withData = ALL_CATEGORIES.filter(c => categoryHasData(c, counts));
  const allSelected = withData.length > 0 && withData.every(c => selected.has(c));
  const noneSelected = !ALL_CATEGORIES.some(c => selected.has(c));

  if (done) {
    const successCount = ALL_CATEGORIES.filter(c => progress[c] === 'done').length;
    const errorCount = errors.length;
    return (
      <div className="p-6 space-y-4">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${errorCount > 0 ? 'bg-amber-900/30' : 'bg-emerald-900/30'}`}>
            {errorCount > 0 ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-amber-400">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              {errorCount > 0 ? 'Cleanup completed with errors' : 'Cleanup complete'}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              {successCount} {successCount === 1 ? 'category' : 'categories'} cleared
              {errorCount > 0 && `, ${errorCount} failed`}
            </p>
          </div>
        </div>

        {errors.length > 0 && (
          <div className="space-y-1">
            {errors.map((err, i) => (
              <div key={i} className="text-xs text-red-400 bg-red-950/30 border border-red-900/50 rounded px-3 py-1.5">
                <span className="font-medium">{CATEGORY_META[err.category].label}:</span> {err.message}
              </div>
            ))}
          </div>
        )}

        <button
          onClick={onClose}
          className="w-full bg-zinc-700 text-zinc-200 text-sm py-2 rounded-md hover:bg-zinc-600 transition-colors"
        >
          Close
        </button>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-100">Select data to delete</h3>
        <button
          onClick={onToggleAll}
          disabled={deleting || withData.length === 0}
          className="text-[10px] text-indigo-400 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {allSelected ? 'Deselect all' : 'Select all'}
        </button>
      </div>

      <div className="space-y-1">
        {ALL_CATEGORIES.map(cat => {
          const hasData = categoryHasData(cat, counts);
          const isSelected = selected.has(cat);
          const status = progress[cat] as CategoryStatus | undefined;
          const error = errors.find(e => e.category === cat);

          return (
            <div key={cat}>
              <label
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors ${
                  deleting ? '' : hasData ? 'hover:bg-zinc-800 cursor-pointer' : 'opacity-40 cursor-not-allowed'
                }`}
              >
                <input
                  type="checkbox"
                  checked={isSelected}
                  disabled={!hasData || deleting}
                  onChange={() => onToggle(cat)}
                  className="toggle-switch shrink-0"
                />
                <span className="text-sm shrink-0">{CATEGORY_META[cat].icon}</span>
                <div className="flex-1 min-w-0">
                  <span className="text-xs text-zinc-200 font-medium">{CATEGORY_META[cat].label}</span>
                  <span className="text-[10px] text-zinc-500 ml-2">{categoryCountLabel(cat, counts)}</span>
                </div>
                {status && <StatusIcon status={status} />}
              </label>
              {error && (
                <p className="text-[10px] text-red-400 ml-12 mt-0.5 mb-1">{error.message}</p>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onBack}
          disabled={deleting}
          className="px-4 bg-zinc-700 text-zinc-300 text-sm py-2 rounded-md hover:bg-zinc-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Back
        </button>
        <button
          onClick={onDelete}
          disabled={noneSelected || deleting}
          className="flex-1 bg-red-600 text-white text-sm py-2 rounded-md hover:bg-red-500 transition-colors font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {deleting ? 'Deleting...' : 'Delete Selected'}
        </button>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: CategoryStatus }) {
  switch (status) {
    case 'in-progress':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-indigo-400 animate-spin">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
      );
    case 'done':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
    case 'error':
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-red-400">
          <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
        </svg>
      );
    default:
      return null;
  }
}
