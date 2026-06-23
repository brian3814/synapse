import { extractPageContent, getSelectedText, extractPageTerms, analyzePageComplexity } from './page-extractor';
import { executeTool } from './tool-executor';

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
    case 'EXTRACT_PAGE': {
      const content = extractPageContent();
      chrome.runtime.sendMessage({
        type: 'PAGE_CONTENT',
        payload: content,
        source: 'content-script',
        timestamp: Date.now(),
      });
      sendResponse({ success: true });
      break;
    }

    case 'EXTRACT_SELECTION': {
      const selectedText = message.payload?.text || getSelectedText();
      if (selectedText) {
        chrome.runtime.sendMessage({
          type: 'SELECTION',
          payload: {
            text: selectedText,
            url: window.location.href,
          },
          source: 'content-script',
          timestamp: Date.now(),
        });
      }
      sendResponse({ success: true });
      break;
    }

    case 'TOOL_EXECUTE': {
      try {
        const { toolName, toolInput } = message.payload;
        const result = executeTool(toolName, toolInput ?? {});
        sendResponse({ result });
      } catch (e: any) {
        sendResponse({ result: '', error: e.message });
      }
      break;
    }

    case 'EXTRACT_PAGE_TERMS': {
      const pageTerms = extractPageTerms();
      chrome.runtime.sendMessage({
        type: 'PAGE_TERMS',
        payload: pageTerms,
        source: 'content-script',
        timestamp: Date.now(),
      });
      sendResponse({ success: true });
      break;
    }

    case 'ANALYZE_PAGE': {
      const complexity = analyzePageComplexity();
      sendResponse({ complexity });
      break;
    }

    case 'GET_PAGE_CONTENT_QUICK': {
      const result = executeTool('get_page_content', { format: 'markdown' });
      sendResponse(JSON.parse(result)); // { title, url, content }
      break;
    }

    case 'PING': {
      sendResponse({ pong: true });
      break;
    }
  }

  return false;
});
