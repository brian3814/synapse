import type { PlatformBrowser, TabInfo } from '../types';

export class ChromeBrowser implements PlatformBrowser {
  async getActiveTab(): Promise<TabInfo | null> {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id || !tab.url) return null;
    return { id: tab.id, url: tab.url, title: tab.title ?? '' };
  }

  async getPageContent(_tabId: number): Promise<string> {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT_QUICK' });
    return (response as any)?.content ?? '';
  }

  async executeTool(tabId: number, tool: string, params: Record<string, unknown>): Promise<string> {
    const response = await chrome.runtime.sendMessage({
      type: 'TOOL_EXECUTE',
      payload: { tabId, toolName: tool, toolInput: params },
    });
    if ((response as any)?.error) throw new Error((response as any).error);
    return (response as any)?.result ?? '';
  }

  onPageCapture(cb: (data: { title: string; url: string; content: string }) => void): () => void {
    const listener = (message: any) => {
      if (message.type === 'COMPANION_PAGE_CAPTURED') {
        cb(message.payload);
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }

  onReadingQueue(_cb: (data: { url: string; title: string }) => void): () => void {
    return () => {};
  }

  // --- Chrome-specific methods (not on PlatformBrowser interface) ---

  async analyzePage(): Promise<any> {
    return chrome.runtime.sendMessage({ type: 'ANALYZE_PAGE' });
  }

  async fetchUrl(url: string, _maxBytes?: number): Promise<any> {
    return chrome.runtime.sendMessage({ type: 'FETCH_URL', payload: { url } });
  }

  async getPageContentFull(): Promise<{ title: string; url: string; content: string } | null> {
    const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT_QUICK' });
    if (!(response as any)?.content) return null;
    return response as { title: string; url: string; content: string };
  }

  async toggleDisplayMode(currentMode: string): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'TOGGLE_DISPLAY_MODE',
      payload: { currentMode },
    });
  }

  async openSettingsTab(): Promise<void> {
    await chrome.runtime.sendMessage({ type: 'OPEN_SETTINGS_TAB' });
  }

  async sendOAuth(type: string): Promise<any> {
    return chrome.runtime.sendMessage({ type });
  }

  onRuntimeMessage(cb: (message: any) => void): () => void {
    const listener = (message: any) => cb(message);
    chrome.runtime.onMessage.addListener(listener);
    return () => chrome.runtime.onMessage.removeListener(listener);
  }

  async extractPageTerms(tabId: number): Promise<void> {
    await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_PAGE_TERMS' });
  }

  async ensureContentScript(tabId: number): Promise<void> {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-script.js'],
      });
    } catch {
      // Cannot inject (e.g. chrome:// pages)
    }
  }

  onTabActivated(cb: (info: { tabId: number }) => void): () => void {
    chrome.tabs.onActivated.addListener(cb);
    return () => chrome.tabs.onActivated.removeListener(cb);
  }

  async sendReadingListRemove(url: string): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'READING_LIST_REMOVE',
      payload: { url },
    });
  }

  async sendReadingListRetry(url: string): Promise<void> {
    await chrome.runtime.sendMessage({
      type: 'READING_LIST_RETRY',
      payload: { url },
    });
  }
}
