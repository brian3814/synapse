import type { PlatformFiles } from '../types';

export class ChromeFiles implements PlatformFiles {
  private dirs = new Map<string, FileSystemDirectoryHandle>();
  private root: FileSystemDirectoryHandle | null = null;

  private async getRoot(): Promise<FileSystemDirectoryHandle> {
    if (!this.root) {
      this.root = await navigator.storage.getDirectory();
    }
    return this.root;
  }

  private async getDir(prefix: string): Promise<FileSystemDirectoryHandle> {
    const cached = this.dirs.get(prefix);
    if (cached) return cached;
    const root = await this.getRoot();
    const dir = await root.getDirectoryHandle(prefix, { create: true });
    this.dirs.set(prefix, dir);
    return dir;
  }

  private parsePath(path: string): { dir: string; filename: string } {
    if (path.includes('..') || path.startsWith('/')) {
      throw new Error(`Invalid path: ${path}`);
    }
    const lastSlash = path.lastIndexOf('/');
    if (lastSlash === -1) {
      throw new Error(`Path must include a directory prefix: ${path}`);
    }
    return {
      dir: path.slice(0, lastSlash),
      filename: path.slice(lastSlash + 1),
    };
  }

  async read(path: string): Promise<string | null> {
    const { dir, filename } = this.parsePath(path);
    try {
      const dirHandle = await this.getDir(dir);
      const fileHandle = await dirHandle.getFileHandle(filename);
      const file = await fileHandle.getFile();
      return await file.text();
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return null;
      throw e;
    }
  }

  async write(path: string, content: string): Promise<void> {
    const { dir, filename } = this.parsePath(path);
    const dirHandle = await this.getDir(dir);
    const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content);
    await writable.close();
  }

  async remove(path: string): Promise<void> {
    const { dir, filename } = this.parsePath(path);
    try {
      const dirHandle = await this.getDir(dir);
      await dirHandle.removeEntry(filename);
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }

  async list(prefix: string): Promise<string[]> {
    const cleanPrefix = prefix.replace(/\/$/, '');
    try {
      const dirHandle = await this.getDir(cleanPrefix);
      const files: string[] = [];
      for await (const [name] of (dirHandle as any).entries()) {
        if (typeof name === 'string' && name.endsWith('.md')) {
          files.push(`${cleanPrefix}/${name}`);
        }
      }
      return files;
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return [];
      throw e;
    }
  }
}
