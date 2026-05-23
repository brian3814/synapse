import type { PlatformVault } from '../types';

export class ChromeVault implements PlatformVault {
  private vaultDir: FileSystemDirectoryHandle | null = null;

  async init(): Promise<void> {
    if (this.vaultDir) return;
    const root = await navigator.storage.getDirectory();
    this.vaultDir = await root.getDirectoryHandle('vault', { create: true });
  }

  private dir(): FileSystemDirectoryHandle {
    if (!this.vaultDir) throw new Error('[OPFS] Vault store not initialised — call init() first');
    return this.vaultDir;
  }

  async store(data: ArrayBuffer, filename: string, nodeId: string): Promise<{ vaultPath: string }> {
    const nodeDir = await this.dir().getDirectoryHandle(nodeId, { create: true });
    const handle = await nodeDir.getFileHandle(filename, { create: true });
    const writable = await handle.createWritable();
    await writable.write(data);
    await writable.close();
    return { vaultPath: `vault/${nodeId}/${filename}` };
  }

  async read(vaultPath: string): Promise<ArrayBuffer> {
    const parts = vaultPath.replace(/^vault\//, '').split('/');
    const nodeId = parts[0];
    const filename = parts.slice(1).join('/');
    const nodeDir = await this.dir().getDirectoryHandle(nodeId);
    const handle = await nodeDir.getFileHandle(filename);
    const file = await handle.getFile();
    return await file.arrayBuffer();
  }

  async remove(vaultPath: string): Promise<void> {
    const parts = vaultPath.replace(/^vault\//, '').split('/');
    const nodeId = parts[0];
    const filename = parts.slice(1).join('/');
    try {
      const nodeDir = await this.dir().getDirectoryHandle(nodeId);
      await nodeDir.removeEntry(filename);
      // Remove empty node directory
      let isEmpty = true;
      for await (const _ of (nodeDir as any).entries()) {
        isEmpty = false;
        break;
      }
      if (isEmpty) {
        await this.dir().removeEntry(nodeId);
      }
    } catch (e: unknown) {
      if (e instanceof DOMException && e.name === 'NotFoundError') return;
      throw e;
    }
  }

  async getStorageUsage(): Promise<{ bytes: number; fileCount: number }> {
    let bytes = 0;
    let fileCount = 0;
    for await (const [, handle] of (this.dir() as any).entries()) {
      if (handle.kind !== 'directory') continue;
      const nodeDir = handle as FileSystemDirectoryHandle;
      for await (const [, fileHandle] of (nodeDir as any).entries()) {
        if (fileHandle.kind !== 'file') continue;
        const file = await (fileHandle as FileSystemFileHandle).getFile();
        bytes += file.size;
        fileCount++;
      }
    }
    return { bytes, fileCount };
  }
}
