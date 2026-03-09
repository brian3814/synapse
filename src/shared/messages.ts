// Message types for communication between extension contexts
export type MessageSource = 'content-script' | 'service-worker' | 'side-panel' | 'tab' | 'offscreen';

// DB Worker messages (postMessage, not chrome.runtime)
export type DbWorkerRequest =
  | { type: 'init' }
  | { type: 'exec'; sql: string; params?: unknown[] }
  | { type: 'query'; sql: string; params?: unknown[] }
  | { type: 'run-migrations' };

export type DbWorkerResponse =
  | { type: 'init-result'; success: boolean; error?: string }
  | { type: 'exec-result'; requestId: string; success: boolean; changes?: number; error?: string }
  | { type: 'query-result'; requestId: string; success: boolean; rows?: unknown[]; error?: string }
  | { type: 'migration-result'; requestId: string; success: boolean; version?: number; error?: string };

// Wrap with requestId for the postMessage protocol
export interface DbRequest {
  requestId: string;
  message: DbWorkerRequest;
}

export interface DbResponse {
  requestId: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Chrome runtime messages (between content script, service worker, panel/tab, offscreen)
export interface ExtensionMessage {
  type: string;
  payload?: unknown;
  requestId?: string;
  source?: MessageSource;
  timestamp?: number;
}

// Content script -> Service worker
export interface PageContentMessage extends ExtensionMessage {
  type: 'PAGE_CONTENT';
  payload: {
    title: string;
    text: string;
    url: string;
    selectedText?: string;
  };
}

export interface SelectionMessage extends ExtensionMessage {
  type: 'SELECTION';
  payload: {
    text: string;
    url: string;
  };
}

// Service worker -> Content script
export interface ExtractPageMessage extends ExtensionMessage {
  type: 'EXTRACT_PAGE';
}

export interface ExtractSelectionMessage extends ExtensionMessage {
  type: 'EXTRACT_SELECTION';
}

// UI -> Service worker (no apiKey — key is injected by the SW before forwarding to offscreen)
export interface LLMRequestMessage extends ExtensionMessage {
  type: 'LLM_REQUEST';
  payload: {
    provider: string;
    model: string;
    prompt: string;
    systemPrompt?: string;
  };
}

// Service worker -> Offscreen (internal, with apiKey injected by SW)
export interface LLMRequestWithKeyMessage extends ExtensionMessage {
  type: 'LLM_REQUEST_WITH_KEY';
  payload: LLMRequestMessage['payload'] & { apiKey: string };
}

// Offscreen -> Service worker -> Panel/Tab
export interface LLMStreamChunkMessage extends ExtensionMessage {
  type: 'LLM_STREAM_CHUNK';
  payload: {
    requestId: string;
    chunk: string;
    done: boolean;
    content?: string;
    error?: string;
  };
}

export interface LLMResponseMessage extends ExtensionMessage {
  type: 'LLM_RESPONSE';
  payload: {
    requestId: string;
    content: string;
    error?: string;
  };
}

// Display mode messages
export interface OpenSidePanelMessage extends ExtensionMessage {
  type: 'OPEN_SIDE_PANEL';
}

export interface OpenTabMessage extends ExtensionMessage {
  type: 'OPEN_TAB';
}

export interface ToggleDisplayModeMessage extends ExtensionMessage {
  type: 'TOGGLE_DISPLAY_MODE';
  payload: { currentMode: 'sidePanel' | 'tab' };
}

// Agent extraction messages
// UI -> Service worker (no apiKey)
export interface AgentRunStartMessage extends ExtensionMessage {
  type: 'AGENT_RUN_START';
  payload: {
    runId: string;
    userPrompt: string;
    tabId: number;
    provider: string;
    model: string;
    maxIterations?: number;
  };
}

// Service worker -> Offscreen (internal, with apiKey injected by SW)
export interface AgentRunStartWithKeyMessage extends ExtensionMessage {
  type: 'AGENT_RUN_START_WITH_KEY';
  payload: AgentRunStartMessage['payload'] & { apiKey: string };
}

export interface ToolExecuteMessage extends ExtensionMessage {
  type: 'TOOL_EXECUTE';
  payload: {
    runId: string;
    toolCallId: string;
    toolName: string;
    toolInput: Record<string, unknown>;
    tabId: number;
  };
}

export interface ToolResultMessage extends ExtensionMessage {
  type: 'TOOL_RESULT';
  payload: {
    runId: string;
    toolCallId: string;
    result: string;
    error?: string;
  };
}

export interface AgentProgressMessage extends ExtensionMessage {
  type: 'AGENT_PROGRESS';
  payload: {
    runId: string;
    event: import('./types').AgentProgressEvent;
  };
}

// Keepalive for offscreen
export interface KeepaliveMessage extends ExtensionMessage {
  type: 'KEEPALIVE';
}

// Query engine messages (external extension API)
export interface QueryExecuteMessage extends ExtensionMessage {
  type: 'QUERY_EXECUTE';
  payload: {
    query: unknown;
  };
}

export interface MutationExecuteMessage extends ExtensionMessage {
  type: 'MUTATION_EXECUTE';
  payload: {
    mutation: unknown;
  };
}

// Contextual relevance messages (Phase 4)
export interface ExtractPageTermsMessage extends ExtensionMessage {
  type: 'EXTRACT_PAGE_TERMS';
}

export interface PageTermsMessage extends ExtensionMessage {
  type: 'PAGE_TERMS';
  payload: {
    url: string;
    title: string;
    terms: string[];
  };
}

// Union of all chrome.runtime messages
export type RuntimeMessage =
  | PageContentMessage
  | SelectionMessage
  | ExtractPageMessage
  | ExtractSelectionMessage
  | LLMRequestMessage
  | LLMRequestWithKeyMessage
  | LLMStreamChunkMessage
  | LLMResponseMessage
  | OpenSidePanelMessage
  | OpenTabMessage
  | ToggleDisplayModeMessage
  | KeepaliveMessage
  | QueryExecuteMessage
  | MutationExecuteMessage
  | AgentRunStartMessage
  | AgentRunStartWithKeyMessage
  | ToolExecuteMessage
  | ToolResultMessage
  | AgentProgressMessage
  | ExtractPageTermsMessage
  | PageTermsMessage;

// Helper to create messages
export function createMessage<T extends ExtensionMessage>(
  msg: Omit<T, 'timestamp'> & { source: MessageSource }
): T {
  return {
    ...msg,
    timestamp: Date.now(),
  } as T;
}
