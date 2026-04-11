/**
 * OPFS-based note content store.
 *
 * Stores note markdown as individual files in OPFS `notes/{nodeId}.md`.
 * Runs on the UI thread using the async OPFS API — bypasses the
 * SharedWorker/DedicatedWorker chain for zero-hop reads/writes.
 *
 * wa-sqlite stores `kg_extension.db` at the OPFS root; the `notes/`
 * subdirectory is completely independent (no lock contention).
 */

let notesDir: FileSystemDirectoryHandle | null = null;

/** Initialise the `notes/` OPFS directory. Idempotent. */
export async function init(): Promise<void> {
  if (notesDir) return;
  const root = await navigator.storage.getDirectory();
  notesDir = await root.getDirectoryHandle('notes', { create: true });
}

function dir(): FileSystemDirectoryHandle {
  if (!notesDir) throw new Error('[OPFS] Note store not initialised — call init() first');
  return notesDir;
}

/** Write markdown content for a note. Creates the file if it doesn't exist. */
export async function write(nodeId: string, markdown: string): Promise<void> {
  const handle = await dir().getFileHandle(`${nodeId}.md`, { create: true });
  const writable = await handle.createWritable();
  await writable.write(markdown);
  await writable.close();
}

/** Read markdown content for a note. Returns null if the file doesn't exist. */
export async function read(nodeId: string): Promise<string | null> {
  try {
    const handle = await dir().getFileHandle(`${nodeId}.md`);
    const file = await handle.getFile();
    return await file.text();
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return null;
    throw e;
  }
}

/** Delete a note's OPFS file. No-op if the file doesn't exist. */
export async function remove(nodeId: string): Promise<void> {
  try {
    await dir().removeEntry(`${nodeId}.md`);
  } catch (e: unknown) {
    if (e instanceof DOMException && e.name === 'NotFoundError') return;
    throw e;
  }
}

/** List all note node IDs that have OPFS files. */
export async function list(): Promise<string[]> {
  const ids: string[] = [];
  for await (const [name] of (dir() as any).entries()) {
    if (typeof name === 'string' && name.endsWith('.md')) {
      ids.push(name.slice(0, -3));
    }
  }
  return ids;
}

/** Check whether an OPFS file exists for the given note. */
export async function exists(nodeId: string): Promise<boolean> {
  try {
    await dir().getFileHandle(`${nodeId}.md`);
    return true;
  } catch {
    return false;
  }
}
