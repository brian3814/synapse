import { watch, statSync, existsSync, type FSWatcher } from 'fs';
import { sep } from 'path';
import type { VaultEventBus } from './event-bus';
import type { VaultSandboxConfig } from '../../src/shared/agent-settings-types';

const IGNORE_DIRS = new Set(['.kg', '.git', 'node_modules']);
const IGNORE_FILES = new Set(['.DS_Store', 'Thumbs.db', '.gitignore']);
const DEBOUNCE_MS = 500;

export class VaultFileWatcher {
  private watcher: FSWatcher | null = null;
  private vaultPath: string;
  private eventBus: VaultEventBus;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private recentlyWritten = new Set<string>();
  private getSandboxConfig: () => VaultSandboxConfig;

  constructor(vaultPath: string, eventBus: VaultEventBus, getSandboxConfig: () => VaultSandboxConfig) {
    this.vaultPath = vaultPath;
    this.eventBus = eventBus;
    this.getSandboxConfig = getSandboxConfig;
  }

  start(): void {
    if (this.watcher) return;

    try {
      this.watcher = watch(this.vaultPath, { recursive: true }, (eventType, filename) => {
        if (!filename) return;
        this.handleEvent(eventType, filename);
      });

      this.watcher.on('error', (err) => {
        console.error('[FileWatcher] Error:', err);
      });

      console.log('[FileWatcher] Started watching:', this.vaultPath);
    } catch (err) {
      console.error('[FileWatcher] Failed to start:', err);
    }
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.recentlyWritten.clear();
    console.log('[FileWatcher] Stopped');
  }

  markAsAppWritten(relativePath: string): void {
    this.recentlyWritten.add(relativePath);
    setTimeout(() => this.recentlyWritten.delete(relativePath), DEBOUNCE_MS * 2);
  }

  private handleEvent(_eventType: string, filename: string): void {
    const relativePath = filename.split(sep).join('/');

    if (this.shouldIgnore(relativePath)) return;
    if (this.recentlyWritten.has(relativePath)) return;

    // Debounce — editors often write temp files then rename
    const existing = this.debounceTimers.get(relativePath);
    if (existing) clearTimeout(existing);

    this.debounceTimers.set(
      relativePath,
      setTimeout(() => {
        this.debounceTimers.delete(relativePath);
        this.emitEvent(relativePath);
      }, DEBOUNCE_MS),
    );
  }

  private emitEvent(relativePath: string): void {
    const absolutePath = `${this.vaultPath}/${relativePath}`;

    if (!existsSync(absolutePath)) {
      this.eventBus.emit({ type: 'file:removed', relativePath });
      return;
    }

    try {
      const stat = statSync(absolutePath);
      if (stat.isDirectory()) return;

      this.eventBus.emit({ type: 'file:added', relativePath });
    } catch {
      // File may have been removed between check and stat
    }
  }

  private shouldIgnore(relativePath: string): boolean {
    const parts = relativePath.split('/');

    // Ignore files in ignored directories
    for (const part of parts.slice(0, -1)) {
      if (IGNORE_DIRS.has(part)) return true;
    }

    // Ignore files in notes/ (app-managed by NoteFileHandler)
    if (parts[0] === 'notes') return true;

    // Ignore specific filenames
    const filename = parts[parts.length - 1];
    if (IGNORE_FILES.has(filename)) return true;

    // Sandbox: blocked extensions
    const sandbox = this.getSandboxConfig();
    const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.')) : '';
    if (ext && sandbox.blockedExtensions.includes(ext.toLowerCase())) return true;

    // Sandbox: allowed directories (empty = allow all)
    if (sandbox.allowedDirs.length > 0) {
      const inAllowed = sandbox.allowedDirs.some((dir) => relativePath.startsWith(dir));
      if (!inAllowed) return true;
    }

    return false;
  }
}
