let offscreenCreating: Promise<void> | null = null;

export async function ensureOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT as any],
  });

  if (existingContexts.length > 0) return;

  if (offscreenCreating) {
    await offscreenCreating;
    return;
  }

  offscreenCreating = chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: [chrome.offscreen.Reason.WORKERS as any],
    justification: 'LLM API streaming calls that exceed service worker lifetime',
  });

  await offscreenCreating;
  offscreenCreating = null;
}

export async function closeOffscreenDocument(): Promise<void> {
  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT as any],
  });

  if (existingContexts.length > 0) {
    await chrome.offscreen.closeDocument();
  }
}
