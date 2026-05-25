import { useCallback, useRef, useState, useEffect } from 'react';
import { VaultTree } from './VaultTree';
import { useVaultFileSystem } from './useVaultFileSystem';
import { resolveFileType } from './file-open-registry';
import { ImportConfirmDialog } from './ImportConfirmDialog';
import type { VaultFileEntry } from './types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    getPathForFile?: (file: File) => string;
  };
};

const IMPORT_PREF_KEY = 'vault-import-delete-original';

interface VaultExplorerProps {
  rootPath: string;
  onOpenFile: (path: string, fileType: string) => void;
}

export function VaultExplorer({ rootPath, onOpenFile }: VaultExplorerProps) {
  const { treeData, createFile, createFolder, rename, deleteItem, move, importFiles, refresh } = useVaultFileSystem(rootPath);
  const outerRef = useRef<HTMLDivElement>(null);
  const treeContainerRef = useRef<HTMLDivElement>(null);
  const [containerHeight, setContainerHeight] = useState(400);
  const [dragOver, setDragOver] = useState(false);
  const [pendingImport, setPendingImport] = useState<{ filePaths: string[]; fileNames: string[] } | null>(null);

  const importFilesRef = useRef(importFiles);
  importFilesRef.current = importFiles;
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  const measuredRef = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    treeContainerRef.current = node;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerHeight(entry.contentRect.height);
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const handleActivate = useCallback((entry: VaultFileEntry) => {
    if (entry.isFolder || entry.isInternal) return;
    const fileType = resolveFileType(entry.name);
    onOpenFile(entry.id, fileType);
  }, [onOpenFile]);

  const handleImportConfirm = useCallback(async (deleteOriginals: boolean, remember: boolean) => {
    if (!pendingImport) return;
    if (remember) {
      localStorage.setItem(IMPORT_PREF_KEY, deleteOriginals ? 'delete' : 'keep');
    }
    if (deleteOriginals) {
      await window.electronIPC.invoke('vault-explorer:delete-files', pendingImport.filePaths);
    }
    setPendingImport(null);
  }, [pendingImport]);

  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    let enterCount = 0;

    const hasFiles = (dt: DataTransfer | null) =>
      dt?.types.includes('Files') ?? false;

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      enterCount++;
      if (enterCount === 1) setDragOver(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = 'copy';
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.stopPropagation();
      enterCount--;
      if (enterCount <= 0) {
        enterCount = 0;
        setDragOver(false);
      }
    };

    const onDrop = async (e: DragEvent) => {
      if (!hasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      enterCount = 0;
      setDragOver(false);

      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      // File.path is broken on macOS Electron 30+; use webUtils.getPathForFile via preload.
      // See: https://github.com/electron/electron/issues/43534
      const ipc = window.electronIPC;
      const filePaths = Array.from(files)
        .map(f => ipc.getPathForFile ? ipc.getPathForFile(f) : (f as any).path)
        .filter(Boolean);
      if (filePaths.length === 0) return;

      const fileNames = filePaths.map(p => p.split('/').pop() ?? p);
      await importFilesRef.current(filePaths, rootPathRef.current);

      const savedPref = localStorage.getItem(IMPORT_PREF_KEY);
      if (savedPref === 'delete') {
        await ipc.invoke('vault-explorer:delete-files', filePaths);
      } else if (savedPref === 'keep') {
        // do nothing, keep originals
      } else {
        setPendingImport({ filePaths, fileNames });
      }
    };

    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);

    return () => {
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  return (
    <div
      ref={outerRef}
      data-vault-explorer
      className={`flex flex-col h-full select-none ${dragOver ? 'ring-2 ring-inset ring-indigo-500' : ''}`}
    >
      <div className="flex items-center gap-1 px-2 py-1 border-b border-zinc-700 shrink-0">
        <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wide flex-1">Explorer</span>
        <button
          onClick={() => createFile(rootPath, 'untitled.md')}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="New File"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
          </svg>
        </button>
        <button
          onClick={() => createFolder(rootPath, 'New Folder')}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="New Folder"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            <line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/>
          </svg>
        </button>
        <button
          onClick={refresh}
          className="p-1 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 rounded"
          title="Refresh"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
          </svg>
        </button>
      </div>

      <div ref={measuredRef} className="flex-1 min-h-0 overflow-hidden relative">
        <VaultTree
          data={treeData}
          height={containerHeight}
          onActivate={handleActivate}
          onRename={rename}
          onMove={move}
          onDelete={deleteItem}
        />

        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-indigo-500/10 pointer-events-none">
            <span className="text-[11px] text-indigo-300 font-medium">Drop to import</span>
          </div>
        )}
      </div>

      {pendingImport && (
        <ImportConfirmDialog
          fileNames={pendingImport.fileNames}
          onConfirm={handleImportConfirm}
        />
      )}
    </div>
  );
}
