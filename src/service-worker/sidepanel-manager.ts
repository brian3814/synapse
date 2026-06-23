const DISPLAY_MODE_KEY = 'displayMode';

export async function getDisplayMode(): Promise<'sidePanel' | 'tab'> {
  const result = await chrome.storage.local.get(DISPLAY_MODE_KEY) as Record<string, 'sidePanel' | 'tab' | undefined>;
  return result[DISPLAY_MODE_KEY] ?? 'sidePanel';
}

export async function setDisplayMode(mode: 'sidePanel' | 'tab'): Promise<void> {
  await chrome.storage.local.set({ [DISPLAY_MODE_KEY]: mode });
}

export async function openSidePanel(windowId: number): Promise<void> {
  try {
    await (chrome.sidePanel as any).open({ windowId });
  } catch (e) {
    console.error('[SW] Failed to open side panel:', e);
  }
}
