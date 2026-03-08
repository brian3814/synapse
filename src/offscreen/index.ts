import { executeLLMRequestStreaming } from './llm-executor';
import { runAgentLoop } from './agent-loop';

// Chunk buffer to reduce IPC overhead
class ChunkBuffer {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxBytes: number;
  private readonly maxMs: number;
  private readonly flush: (text: string) => void;

  constructor(opts: { maxBytes: number; maxMs: number; flush: (text: string) => void }) {
    this.maxBytes = opts.maxBytes;
    this.maxMs = opts.maxMs;
    this.flush = opts.flush;
  }

  add(text: string) {
    this.buffer += text;
    if (this.buffer.length >= this.maxBytes) {
      this.drain();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.drain(), this.maxMs);
    }
  }

  drain() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const text = this.buffer;
      this.buffer = '';
      this.flush(text);
    }
  }
}

// Listen for messages from the service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'LLM_REQUEST') {
    const requestId = message.requestId ?? crypto.randomUUID();

    // Acknowledge immediately — do NOT return true
    sendResponse({ acknowledged: true, requestId });

    // Stream in background
    const buffer = new ChunkBuffer({
      maxBytes: 100,
      maxMs: 50,
      flush: (text) => {
        chrome.runtime.sendMessage({
          type: 'LLM_STREAM_CHUNK',
          payload: { requestId, chunk: text, done: false },
        }).catch(() => {});
      },
    });

    executeLLMRequestStreaming(message.payload, (chunk, done) => {
      if (done) return; // handled below in .then()
      buffer.add(chunk);
    })
      .then(({ content }) => {
        buffer.drain();
        chrome.runtime.sendMessage({
          type: 'LLM_STREAM_CHUNK',
          payload: { requestId, chunk: '', done: true, content },
        }).catch(() => {});
      })
      .catch((e) => {
        buffer.drain();
        chrome.runtime.sendMessage({
          type: 'LLM_STREAM_CHUNK',
          payload: { requestId, chunk: '', done: true, error: e.message },
        }).catch(() => {});
      });

    return false; // Channel already closed via sendResponse
  }

  if (message.type === 'AGENT_RUN_START') {
    const { runId } = message.payload;
    sendResponse({ acknowledged: true, runId });

    const chunkBuffer = new ChunkBuffer({
      maxBytes: 100,
      maxMs: 50,
      flush: (text) => {
        chrome.runtime.sendMessage({
          type: 'AGENT_PROGRESS',
          payload: { runId, event: { type: 'llm_chunk', text } },
        }).catch(() => {});
      },
    });

    runAgentLoop({
      runId,
      userPrompt: message.payload.userPrompt,
      tabId: message.payload.tabId,
      apiKey: message.payload.apiKey,
      model: message.payload.model,
      maxIterations: message.payload.maxIterations,
      onProgress: (event) => {
        if (event.type === 'llm_chunk') {
          chunkBuffer.add(event.text ?? '');
        } else {
          chunkBuffer.drain();
          chrome.runtime.sendMessage({
            type: 'AGENT_PROGRESS',
            payload: { runId, event },
          }).catch(() => {});
        }
      },
    });

    return false;
  }

  if (message.type === 'KEEPALIVE') {
    sendResponse({ alive: true });
    return false;
  }
});

console.log('[Offscreen] Document loaded');
