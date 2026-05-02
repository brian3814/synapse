import type { PlatformBrowser, TabInfo } from '../types';

declare const window: Window & {
  electronIPC: {
    invoke(channel: string, ...args: unknown[]): Promise<unknown>;
    on(channel: string, cb: (...args: unknown[]) => void): () => void;
  };
};

export class ElectronBrowser implements PlatformBrowser {
  async getActiveTab(): Promise<TabInfo | null> {
    return null; // No tabs in desktop mode
  }

  async getPageContent(_tabId: number): Promise<string> {
    return ''; // Would need companion extension
  }

  async executeTool(_tabId: number, _tool: string, _params: Record<string, unknown>): Promise<string> {
    throw new Error('Browser tool execution requires the companion extension');
  }

  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void {
    return window.electronIPC.on('companion:capture', (data: unknown) => {
      cb(data as { title: string; url: string; content: string });
    });
  }

  // --- Stubs for Chrome-specific methods (no-ops on Electron) ---

  async analyzePage(): Promise<any> {
    return null;
  }

  async fetchUrl(url: string, _maxBytes?: number): Promise<any> {
    return window.electronIPC.invoke('runtime:sendMessage', { type: 'FETCH_URL', payload: { url } });
  }

  async getPageContentFull(): Promise<{ title: string; url: string; content: string } | null> {
    return null;
  }

  async toggleDisplayMode(_currentMode: string): Promise<void> {
    // No-op on Electron — no side panel / tab toggle
  }

  async sendOAuth(_type: string): Promise<any> {
    return null;
  }

  onRuntimeMessage(_cb: (message: any) => void): () => void {
    return () => {};
  }

  async extractPageTerms(_tabId: number): Promise<void> {
    // No-op on Electron
  }

  async ensureContentScript(_tabId: number): Promise<void> {
    // No-op on Electron
  }

  onTabActivated(_cb: (info: { tabId: number }) => void): () => void {
    return () => {};
  }

  async sendReadingListRemove(_url: string): Promise<void> {
    // No-op on Electron — no Chrome reading list
  }

  async sendReadingListRetry(_url: string): Promise<void> {
    // No-op on Electron — no Chrome reading list
  }
}
