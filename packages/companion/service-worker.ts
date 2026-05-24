const DESKTOP_PORT = 19876;
const DESKTOP_URL = `http://127.0.0.1:${DESKTOP_PORT}`;

function capturePageContent(): { title: string; url: string; content: string } {
  const title = document.title;
  const url = location.href;

  const clone = document.body.cloneNode(true) as HTMLElement;

  const removeSelectors = [
    'script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    'iframe', 'svg', '.ad', '.ads', '.advertisement',
  ];
  removeSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  function extractMarkdown(el: HTMLElement): string {
    const blocks: string[] = [];
    for (const child of Array.from(el.children)) {
      const tag = child.tagName.toLowerCase();
      const text = (child as HTMLElement).innerText?.trim();
      if (!text) continue;

      if (tag.match(/^h[1-6]$/)) {
        blocks.push('#'.repeat(parseInt(tag[1])) + ' ' + text);
      } else if (tag === 'pre' || tag === 'code') {
        blocks.push('```\n' + text + '\n```');
      } else if (tag === 'ul' || tag === 'ol') {
        Array.from(child.querySelectorAll(':scope > li')).forEach((li, i) => {
          const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
          blocks.push(prefix + (li as HTMLElement).innerText.trim());
        });
      } else if (tag === 'table') {
        const rows = Array.from(child.querySelectorAll('tr'));
        const tableRows: string[] = [];
        rows.forEach((row, ri) => {
          const cells = Array.from(row.querySelectorAll('th, td'))
            .map((c) => (c as HTMLElement).innerText.trim());
          tableRows.push('| ' + cells.join(' | ') + ' |');
          if (ri === 0) tableRows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
        });
        blocks.push(tableRows.join('\n'));
      } else if (tag === 'blockquote') {
        blocks.push('> ' + text.replace(/\n/g, '\n> '));
      } else {
        if (child.children.length > 3) {
          blocks.push(extractMarkdown(child as HTMLElement));
        } else {
          blocks.push(text);
        }
      }
    }
    return blocks.join('\n\n');
  }

  let content = extractMarkdown(clone);
  content = content.replace(/\n{3,}/g, '\n\n');
  if (content.length > 50_000) {
    content = content.substring(0, 50_000) + '\n\n...[truncated]';
  }

  return { title, url, content };
}

interface VaultInfo {
  path: string;
  name: string;
  lastOpened: string;
}

let cachedVaults: VaultInfo[] = [];
let selectedVaultPath: string | null = null;

async function checkDesktopOnline(): Promise<boolean> {
  try {
    const res = await fetch(`${DESKTOP_URL}/api/identify`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function fetchVaults(): Promise<VaultInfo[]> {
  try {
    const res = await fetch(`${DESKTOP_URL}/api/vaults`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json();
    return data.vaults ?? [];
  } catch {
    return [];
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'kg-extract-page',
    title: 'Extract with Synapse',
    contexts: ['page', 'link'],
  });
  chrome.contextMenus.create({
    id: 'kg-reading-queue',
    title: 'Add to Synapse reading list',
    contexts: ['page', 'link'],
  });
});

function updateMenuTitles(): void {
  const vault = selectedVaultPath
    ? cachedVaults.find((v) => v.path === selectedVaultPath)
    : cachedVaults[0];
  const suffix = vault ? ` → ${vault.name}` : '';
  chrome.contextMenus.update('kg-extract-page', { title: `Extract with Synapse${suffix}` });
  chrome.contextMenus.update('kg-reading-queue', { title: `Add to Synapse reading list${suffix}` });
}

function showBadge(tabId: number, success: boolean, text?: string): void {
  chrome.action.setBadgeText({ text: text ?? (success ? '✓' : '✗'), tabId });
  chrome.action.setBadgeBackgroundColor({ color: success ? '#22c55e' : '#ef4444', tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: '', tabId }), 3000);
}

async function captureAndSend(tabId: number): Promise<void> {
  const online = await checkDesktopOnline();
  if (!online) throw new Error('Synapse desktop app is not running');

  if (cachedVaults.length === 0) cachedVaults = await fetchVaults();
  const vault = selectedVaultPath
    ? cachedVaults.find((v) => v.path === selectedVaultPath)
    : cachedVaults[0];

  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: capturePageContent,
  });

  const captured = results?.[0]?.result;
  if (!captured?.content) throw new Error('No content captured');

  const response = await fetch(`${DESKTOP_URL}/api/capture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...captured,
      targetVaultPath: vault?.path,
      targetVaultName: vault?.name,
    }),
  });

  if (!response.ok) throw new Error(`Desktop returned ${response.status}`);
}

async function addToReadingQueue(url: string, title: string): Promise<void> {
  const online = await checkDesktopOnline();
  if (!online) throw new Error('Synapse desktop app is not running');

  if (cachedVaults.length === 0) cachedVaults = await fetchVaults();
  const vault = selectedVaultPath
    ? cachedVaults.find((v) => v.path === selectedVaultPath)
    : cachedVaults[0];

  const response = await fetch(`${DESKTOP_URL}/api/reading-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      title,
      targetVaultPath: vault?.path,
      targetVaultName: vault?.name,
    }),
  });

  if (!response.ok) throw new Error(`Desktop returned ${response.status}`);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id || !tab.url) return;

  if (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) {
    showBadge(tab.id, false);
    return;
  }

  try {
    if (info.menuItemId === 'kg-extract-page') {
      await captureAndSend(tab.id);
      showBadge(tab.id, true);
    } else if (info.menuItemId === 'kg-reading-queue') {
      const targetUrl = info.linkUrl ?? tab.url;
      const title = tab.title ?? targetUrl;
      await addToReadingQueue(targetUrl, title);
      showBadge(tab.id, true);
    }
  } catch (e: any) {
    console.error('[Companion] Context menu action failed:', e);
    showBadge(tab.id, false, '!');
  }
});

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'GET_VAULTS') {
    (async () => {
      const online = await checkDesktopOnline();
      if (!online) {
        sendResponse({ online: false, vaults: [] });
        return;
      }
      cachedVaults = await fetchVaults();
      updateMenuTitles();
      sendResponse({ online: true, vaults: cachedVaults, selected: selectedVaultPath });
    })();
    return true;
  }
  if (message.type === 'SET_VAULT') {
    selectedVaultPath = message.path;
    updateMenuTitles();
    sendResponse({ ok: true });
    return true;
  }
  if (message.type === 'DO_CAPTURE') {
    (async () => {
      try {
        await captureAndSend(message.tabId);
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
  if (message.type === 'DO_READING_QUEUE') {
    (async () => {
      try {
        await addToReadingQueue(message.url, message.title);
        sendResponse({ ok: true });
      } catch (e: any) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }
});
