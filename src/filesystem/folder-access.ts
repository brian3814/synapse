/**
 * File System Access API wrapper for reading markdown folders.
 * Persists directory handle in IndexedDB for re-use across sessions.
 */

const IDB_NAME = 'kg_ext_fs';
const IDB_STORE = 'handles';
const HANDLE_KEY = 'markdown_folder';

// ---- IndexedDB handle persistence ----

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(handle, HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function loadHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const req = tx.objectStore(IDB_STORE).get(HANDLE_KEY);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function clearHandle(): Promise<void> {
  const db = await openIDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).delete(HANDLE_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ---- Public API ----

export interface FolderStatus {
  connected: boolean;
  name: string | null;
  permissionGranted: boolean;
}

export interface MarkdownFile {
  path: string;
  name: string;
  lastModified: number;
  content: string;
}

/** Prompt user to pick a directory and persist the handle */
export async function pickFolder(): Promise<FileSystemDirectoryHandle> {
  const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
  await storeHandle(handle);
  return handle;
}

/** Get the stored directory handle, verifying permission */
export async function getStoredFolder(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await loadHandle();
  if (!handle) return null;

  // Verify we still have permission
  const permission = await (handle as any).queryPermission({ mode: 'readwrite' });
  if (permission === 'granted') return handle;

  return handle;
}

/** Request permission for a stored handle (requires user gesture) */
export async function requestPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const result = await (handle as any).requestPermission({ mode: 'readwrite' });
  return result === 'granted';
}

/** Check current folder status without prompting */
export async function getFolderStatus(): Promise<FolderStatus> {
  const handle = await loadHandle();
  if (!handle) return { connected: false, name: null, permissionGranted: false };

  const permission = await (handle as any).queryPermission({ mode: 'readwrite' });
  return {
    connected: true,
    name: handle.name,
    permissionGranted: permission === 'granted',
  };
}

/** Disconnect the folder (remove stored handle) */
export async function disconnectFolder(): Promise<void> {
  await clearHandle();
}

/** Read all .md files from a directory handle (recursive) */
export async function readMarkdownFiles(
  dirHandle: FileSystemDirectoryHandle,
  basePath = ''
): Promise<MarkdownFile[]> {
  const files: MarkdownFile[] = [];

  for await (const [name, entry] of (dirHandle as any).entries()) {
    const entryPath = basePath ? `${basePath}/${name}` : name;

    if (entry.kind === 'directory') {
      // Skip hidden directories
      if (name.startsWith('.')) continue;
      const subFiles = await readMarkdownFiles(entry as FileSystemDirectoryHandle, entryPath);
      files.push(...subFiles);
    } else if (entry.kind === 'file' && name.endsWith('.md') && name !== '_kg_index.md') {
      try {
        const fileHandle = entry as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        const content = await file.text();
        files.push({
          path: entryPath,
          name,
          lastModified: file.lastModified,
          content,
        });
      } catch (e) {
        console.warn(`[FS] Failed to read ${entryPath}:`, e);
      }
    }
  }

  return files;
}

/** Write a markdown file to the folder */
export async function writeMarkdownFile(
  dirHandle: FileSystemDirectoryHandle,
  path: string,
  content: string
): Promise<void> {
  // Navigate to subdirectories, creating them if needed
  const parts = path.split('/');
  const fileName = parts.pop()!;
  let currentDir = dirHandle;

  for (const part of parts) {
    currentDir = await currentDir.getDirectoryHandle(part, { create: true });
  }

  const fileHandle = await currentDir.getFileHandle(fileName, { create: true });
  const writable = await (fileHandle as any).createWritable();
  await writable.write(content);
  await writable.close();
}

/** Get only file metadata (path + lastModified) without reading content */
export async function getFileMetadata(
  dirHandle: FileSystemDirectoryHandle,
  basePath = ''
): Promise<Array<{ path: string; name: string; lastModified: number }>> {
  const files: Array<{ path: string; name: string; lastModified: number }> = [];

  for await (const [name, entry] of (dirHandle as any).entries()) {
    const entryPath = basePath ? `${basePath}/${name}` : name;

    if (entry.kind === 'directory') {
      if (name.startsWith('.')) continue;
      const subFiles = await getFileMetadata(entry as FileSystemDirectoryHandle, entryPath);
      files.push(...subFiles);
    } else if (entry.kind === 'file' && name.endsWith('.md') && name !== '_kg_index.md') {
      try {
        const file = await (entry as FileSystemFileHandle).getFile();
        files.push({ path: entryPath, name, lastModified: file.lastModified });
      } catch {
        // Skip unreadable files
      }
    }
  }

  return files;
}
