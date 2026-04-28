const DESKTOP_PORT = 19876;
const DESKTOP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url) return;

  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
    return;
  }

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content-capture.js'],
    });

    const captured = results?.[0]?.result as { title: string; url: string; content: string } | undefined;
    if (!captured?.content) {
      throw new Error('No content captured');
    }

    const response = await fetch(`${DESKTOP_URL}/api/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(captured),
    });

    if (!response.ok) {
      throw new Error(`Desktop returned ${response.status}`);
    }

    chrome.action.setBadgeText({ text: '✓', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#22c55e', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 2000);
  } catch (e: any) {
    console.error('[Companion] Capture failed:', e);
    chrome.action.setBadgeText({ text: '✗', tabId: tab.id });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444', tabId: tab.id });
    setTimeout(() => chrome.action.setBadgeText({ text: '', tabId: tab.id }), 3000);
  }
});
