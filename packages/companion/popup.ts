const content = document.getElementById('content')!;

interface VaultInfo {
  path: string;
  name: string;
  lastOpened: string;
}

function render(html: string) {
  content.innerHTML = html;
}

function showOffline() {
  render(`
    <div class="status offline"><span class="dot"></span> Desktop app is not running</div>
    <p style="font-size: 11px; color: #71717a; line-height: 1.4;">
      Start the Synapse desktop app to capture pages and add to reading list.
    </p>
  `);
}

function showOnline(vaults: VaultInfo[], selected: string | null) {
  const options = vaults.map((v) =>
    `<option value="${v.path}" ${v.path === selected ? 'selected' : ''}>${v.name} — ${v.path}</option>`
  ).join('');

  const vaultSelector = vaults.length > 0 ? `
    <label>Target Vault</label>
    <select id="vault-select">${options}</select>
  ` : '';

  render(`
    <div class="status online"><span class="dot"></span> Connected</div>
    ${vaultSelector}
    <div class="actions">
      <button class="btn-primary" id="btn-capture">Capture This Page</button>
      <button class="btn-secondary" id="btn-reading">Add to Reading List</button>
    </div>
    <div id="msg-area"></div>
  `);

  const vaultSelect = document.getElementById('vault-select') as HTMLSelectElement | null;
  vaultSelect?.addEventListener('change', () => {
    chrome.runtime.sendMessage({ type: 'SET_VAULT', path: vaultSelect.value });
  });

  document.getElementById('btn-capture')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-capture') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Capturing...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) throw new Error('No active tab');
      await chrome.runtime.sendMessage({ type: 'DO_CAPTURE', tabId: tab.id });
      showMessage('Page sent to Synapse', false);
      setTimeout(() => window.close(), 1000);
    } catch (e: any) {
      showMessage(e.message ?? 'Capture failed', true);
      btn.disabled = false;
      btn.textContent = 'Capture This Page';
    }
  });

  document.getElementById('btn-reading')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-reading') as HTMLButtonElement;
    btn.disabled = true;
    btn.textContent = 'Adding...';
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id || !tab.url) throw new Error('No active tab');
      await chrome.runtime.sendMessage({ type: 'DO_READING_QUEUE', url: tab.url, title: tab.title ?? tab.url });
      showMessage('Added to reading list', false);
      setTimeout(() => window.close(), 1000);
    } catch (e: any) {
      showMessage(e.message ?? 'Failed', true);
      btn.disabled = false;
      btn.textContent = 'Add to Reading List';
    }
  });
}

function showMessage(text: string, isError: boolean) {
  const area = document.getElementById('msg-area');
  if (area) area.innerHTML = `<div class="msg ${isError ? 'error' : 'success'}">${text}</div>`;
}

chrome.runtime.sendMessage({ type: 'GET_VAULTS' }, (response) => {
  if (!response || !response.online) {
    showOffline();
  } else {
    showOnline(response.vaults, response.selected);
  }
});
