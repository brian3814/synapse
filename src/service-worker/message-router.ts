import { ensureOffscreenDocument } from './offscreen-manager';
import { handleExtractionResult, removeFromReadingList, triggerExtraction } from './reading-list-handler';
import { openSidePanel } from './sidepanel-manager';
import { openExtensionTab } from './tab-manager';
import type { RuntimeMessage } from '../shared/messages';

export function handleMessage(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response?: unknown) => void
): boolean {
  // Broadcast messages from offscreen — SW should ignore them
  if (message.type === 'LLM_STREAM_CHUNK') return false;
  if (message.type === 'AGENT_PROGRESS') return false;
  if (message.type === 'PAGE_TERMS') return false; // Let UI pick up directly
  if (message.type === 'READING_LIST_EXTRACTION_RESULT') {
    handleExtractionResult((message as any).payload);
    return false; // Let UI also receive the broadcast
  }

  // Handle async responses
  handleMessageAsync(message, sender).then(sendResponse).catch((e) => {
    console.error('[SW] Message handling error:', e);
    sendResponse({ error: e.message });
  });

  return true; // Keep message channel open for async response
}

async function handleMessageAsync(
  message: RuntimeMessage,
  sender: chrome.runtime.MessageSender
): Promise<unknown> {
  switch (message.type) {
    case 'PAGE_CONTENT':
    case 'SELECTION': {
      // Forward content from content script to the side panel/tab
      // Store in session storage for pickup
      await chrome.storage.session.set({
        pendingExtraction: {
          ...message.payload,
          timestamp: Date.now(),
        },
      });
      return { success: true };
    }

    case 'LLM_REQUEST': {
      // Offscreen documents cannot access chrome.storage (see Pitfall #13 in ARCHITECTURE.md).
      // The SW reads the API key from storage and injects it into the payload before forwarding.
      // UI messages intentionally omit the key to prevent leakage via runtime broadcast.
      await ensureOffscreenDocument();
      const apiKey = await getApiKeyFromStorage();
      const withKey = { type: 'LLM_REQUEST_WITH_KEY', requestId: (message as any).requestId, payload: { ...(message as any).payload, apiKey } };
      const response = await chrome.runtime.sendMessage(withKey);
      return response;
    }

    case 'TOGGLE_DISPLAY_MODE': {
      const payload = message.payload as { currentMode: 'sidePanel' | 'tab' };
      if (payload.currentMode === 'sidePanel') {
        await openExtensionTab();
      } else {
        // Open side panel on the sender's window
        const windowId = sender.tab?.windowId;
        if (windowId) {
          await openSidePanel(windowId);
        }
      }
      // UI closes itself via window.close() after this response
      return { success: true };
    }

    case 'AGENT_RUN_START': {
      // Same pattern as LLM_REQUEST — SW injects apiKey (Pitfall #13: offscreen lacks chrome.storage)
      await ensureOffscreenDocument();
      const agentApiKey = await getApiKeyFromStorage();
      const agentWithKey = { type: 'AGENT_RUN_START_WITH_KEY', payload: { ...(message as any).payload, apiKey: agentApiKey } };
      const response = await chrome.runtime.sendMessage(agentWithKey);
      return response;
    }

    case 'TOOL_EXECUTE': {
      // Relay to content script via tabs.sendMessage, return response
      const { tabId } = (message as any).payload;
      try {
        // Ensure content script is injected (handles tabs opened before extension load)
        await ensureContentScript(tabId);
        const response = await chrome.tabs.sendMessage(tabId, message);
        return response;
      } catch (e: any) {
        return { result: '', error: `Content script unreachable: ${e.message}` };
      }
    }

    case 'KEEPALIVE': {
      return { alive: true };
    }

    case 'QUERY_EXECUTE':
    case 'MUTATION_EXECUTE': {
      // Forward to the extension's UI view (side panel or tab) which owns the DB worker.
      // chrome.runtime.sendMessage broadcasts to all extension contexts;
      // the UI's query-message-handler listener will pick it up and respond.
      const response = await chrome.runtime.sendMessage(message);
      return response;
    }

    case 'READING_LIST_REMOVE':
      await removeFromReadingList((message as any).payload.url);
      return { success: true };

    case 'READING_LIST_RETRY': {
      const { url } = (message as any).payload;
      const result = await chrome.storage.local.get('readingListItems') as Record<string, any>;
      const items = result.readingListItems ?? {};
      const item = items[url];
      if (item) await triggerExtraction(url, item.title);
      return { success: true };
    }

    default:
      console.warn('[SW] Unknown message type:', message.type);
      return { error: 'Unknown message type' };
  }
}

// Reads API key from chrome.storage.local. Only the service worker has access to
// chrome.storage — offscreen documents do not (Pitfall #13).
async function getApiKeyFromStorage(): Promise<string> {
  const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
  const key = result.llmConfig?.apiKey;
  if (!key) throw new Error('No API key configured. Go to Settings to add one.');
  return key;
}

async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // Ping the content script to see if it's already there
    await chrome.tabs.sendMessage(tabId, { type: 'PING' });
  } catch {
    // Content script not present — inject it
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content-script.js'],
    });
  }
}
