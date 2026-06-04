import { useState, useEffect, useCallback } from 'react';
import type { VaultFileEntry } from './types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

interface UseVaultFileSystemReturn {
  treeData: VaultFileEntry[];
  createFile: (dirPath: string, name: string) => Promise<void>;
  createFolder: (dirPath: string, name: string) => Promise<void>;
  rename: (oldPath: string, newName: string) => Promise<void>;
  deleteItem: (path: string) => Promise<void>;
  move: (sourcePath: string, destDir: string) => Promise<void>;
  importFiles: (filePaths: string[], destDir: string) => Promise<void>;
  refresh: () => void;
}

function markInternalRecursive(entries: VaultFileEntry[], rootPath: string): VaultFileEntry[] {
  return entries.map(entry => {
    const relativePath = entry.id.slice(rootPath.length + 1);
    const isInternal = relativePath.startsWith('.kg');
    const children = entry.children ? markInternalRecursive(entry.children, rootPath) : undefined;
    return { ...entry, isInternal, children };
  });
}

export function useVaultFileSystem(rootPath: string): UseVaultFileSystemReturn {
  const [treeData, setTreeData] = useState<VaultFileEntry[]>([]);

  const loadTree = useCallback(async () => {
    if (!rootPath) return;
    const tree = await window.electronIPC.invoke('vault-explorer:read-tree', rootPath) as VaultFileEntry[];
    setTreeData(markInternalRecursive(tree, rootPath));
  }, [rootPath]);

  useEffect(() => {
    loadTree();
  }, [loadTree]);

  useEffect(() => {
    if (!rootPath) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = window.electronIPC.on('vault-explorer:fs-changed', () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        loadTree();
      }, 150);
    });

    return () => {
      cleanup();
      if (debounceTimer) clearTimeout(debounceTimer);
    };
  }, [rootPath, loadTree]);

  const createFile = useCallback(async (dirPath: string, name: string) => {
    await window.electronIPC.invoke('vault-explorer:create-file', dirPath, name);
    loadTree();
  }, [loadTree]);

  const createFolder = useCallback(async (dirPath: string, name: string) => {
    await window.electronIPC.invoke('vault-explorer:create-folder', dirPath, name);
    loadTree();
  }, [loadTree]);

  const rename = useCallback(async (oldPath: string, newName: string) => {
    const dir = oldPath.substring(0, oldPath.lastIndexOf('/'));
    const newPath = `${dir}/${newName}`;
    await window.electronIPC.invoke('vault-explorer:rename', oldPath, newPath);
    loadTree();
  }, [loadTree]);

  const deleteItem = useCallback(async (itemPath: string) => {
    await window.electronIPC.invoke('vault-explorer:delete', itemPath);
    loadTree();
  }, [loadTree]);

  const move = useCallback(async (sourcePath: string, destDir: string) => {
    await window.electronIPC.invoke('vault-explorer:move', sourcePath, destDir);
    loadTree();
  }, [loadTree]);

  const importFiles = useCallback(async (filePaths: string[], destDir: string) => {
    await window.electronIPC.invoke('vault-explorer:import-files', filePaths, destDir);
    loadTree();
  }, [loadTree]);

  const refresh = useCallback(() => {
    loadTree();
  }, [loadTree]);

  return { treeData, createFile, createFolder, rename, deleteItem, move, importFiles, refresh };
}
