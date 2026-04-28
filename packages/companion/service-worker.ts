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
      func: capturePageContent,
    });

    const captured = results?.[0]?.result;
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
