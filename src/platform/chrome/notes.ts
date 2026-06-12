import type { PlatformNotes } from '../types';

export class ChromeNotes implements PlatformNotes {
  private notesDir: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    if (this.notesDir) return;
    const root = await navigator.storage.getDirectory();
    this.notesDir = await root.getDirectoryHandle('notes', { create: true });
  }

  private dir(): FileSystemDirectoryHandle {
    if (!this.notesDir) throw new Error('[OPFS] Note store not initialised — call init() first');
    return this.notesDir;
  }

  async write(nodeId: string, markdown: string): Promise<void> {
    const handle = await this.dir().getFileHandle(`${nodeId}.md`, { create: true });
    const writable = await handle.createWritable();
    await writable.write(markdown);
    await writable.close();
  }

  async read(nodeId: string): Promise<string | null> {
    try {
      const handle = await this.dir().getFileHandle(`${nodeId}.md`);
      const file = await handle.getFile();
      return await file.text();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async remove(nodeId: string): Promise<void> {
    try {
      await this.dir().removeEntry(`${nodeId}.md`);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }

  async list(): Promise<string[]> {
    const ids: string[] = [];
    for await (const [name] of (this.dir() as any).entries()) {
      if (typeof name === 'string' && name.endsWith('.md')) {
        ids.push(name.slice(0, -3));
      }
    }
    return ids;
  }

  async exists(nodeId: string): Promise<boolean> {
    try {
      await this.dir().getFileHandle(`${nodeId}.md`);
      return true;
    } catch {
      return false;
    }
  }

  onExternalChange(_cb: (nodeId: string) => void): () => void {
    return () => {};
  }
}
