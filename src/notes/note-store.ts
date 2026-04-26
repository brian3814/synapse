export interface NoteStore {
  init(): Promise<void>;
  read(nodeId: string): Promise<string | null>;
  write(nodeId: string, markdown: string): Promise<void>;
  remove(nodeId: string): Promise<void>;
  list(): Promise<string[]>;
  exists(nodeId: string): Promise<boolean>;
}

let store: NoteStore | null = null;

export function getNoteStore(): NoteStore {
  if (!store) throw new Error('Note store not initialized — call initNoteStore() first');
  return store;
}

export async function initNoteStore(): Promise<void> {
  if (store) return;

  if ((window as any).electronNotes) {
    const { FsNoteStore } = await import('./fs-note-store');
    store = new FsNoteStore();
  } else {
    const { OpfsNoteStore } = await import('./opfs-note-store');
    store = new OpfsNoteStore();
  }

  await store.init();
}

export const read = (nodeId: string) => getNoteStore().read(nodeId);
export const write = (nodeId: string, markdown: string) => getNoteStore().write(nodeId, markdown);
export const remove = (nodeId: string) => getNoteStore().remove(nodeId);
export const list = () => getNoteStore().list();
export const exists = (nodeId: string) => getNoteStore().exists(nodeId);
