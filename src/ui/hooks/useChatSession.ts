import { useState, useCallback, useEffect, useRef } from 'react';
import { chat } from '../../db/client/db-client';
import { streamFromOffscreen, fetchLLMConfigAndTypes } from './nl-query-utils';
import { retrieveRAGContext, formatRAGPrompt, RAG_SYSTEM_PROMPT, type RAGContext } from './rag-pipeline';

type MessageStatus = 'complete' | 'streaming' | 'executing' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ragContext?: RAGContext | null;
  error?: string;
  status: MessageStatus;
}

interface CompactRAGContext {
  nodeCount: number;
  edgeCount: number;
  nodeLabels: string[];
  sourceUrls: string[];
}

function compactifyRAG(ctx: RAGContext): string {
  const compact: CompactRAGContext = {
    nodeCount: ctx.relevantNodes.length,
    edgeCount: ctx.relevantEdges.length,
    nodeLabels: ctx.relevantNodes.slice(0, 10).map((n) => n.name),
    sourceUrls: ctx.sourceExcerpts.map((s) => s.url),
  };
  return JSON.stringify(compact);
}

const MAX_HISTORY_MESSAGES = 20;

export function useChatSession() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const sessionIdRef = useRef<string | null>(null);

  // On mount: restore active session or start fresh
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        // Expire any stale sessions first
        await chat.expireStale();

        const session = await chat.getActiveSession();
        if (session && !cancelled) {
          sessionIdRef.current = session.id;
          const dbMessages = await chat.getMessages(session.id);
          const restored: ChatMessage[] = dbMessages.map((m: any) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            ragContext: m.rag_context ? parseCompactRAG(m.rag_context) : null,
            status: m.status as MessageStatus,
          }));
          setMessages(restored);
        }
      } catch (e) {
        console.error('[useChatSession] Failed to restore session:', e);
      }
      if (!cancelled) setSessionReady(true);
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const ensureSession = useCallback(async (firstMessage: string): Promise<string> => {
    if (sessionIdRef.current) return sessionIdRef.current;

    const id = crypto.randomUUID();
    const title = firstMessage.slice(0, 100);
    await chat.createSession(id, title);
    await chat.pruneSessions();
    sessionIdRef.current = id;
    return id;
  }, []);

  const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  };

  const sendMessage = useCallback(async (input: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    const userMsgId = crypto.randomUUID();
    const userMsg: ChatMessage = {
      id: userMsgId,
      role: 'user',
      content: input,
      status: 'complete',
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      const sessionId = await ensureSession(input);

      // Load conversation history BEFORE saving current message (avoids save + filter round-trip)
      const recentMessages = await chat.getRecentMessages(sessionId, MAX_HISTORY_MESSAGES);
      const historyForLLM = recentMessages
        .map((m: any) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

      // Save user message to DB
      await chat.saveMessage({
        id: userMsgId,
        sessionId,
        role: 'user',
        content: input,
        status: 'complete',
      });

      // RAG retrieval
      updateMessage(assistantId, { content: 'Searching knowledge graph...', status: 'executing' });
      const ragContext = await retrieveRAGContext(input);
      const hasContext = ragContext.relevantNodes.length > 0;

      updateMessage(assistantId, {
        content: '',
        status: 'streaming',
        ragContext: hasContext ? ragContext : null,
      });

      // LLM request
      // Note: historyForLLM contains raw user text + assistant responses.
      // The current prompt may contain RAG context (entity/relationship data).
      // This asymmetry is intentional — RAG context is per-turn retrieval,
      // not replayed from history, to avoid stale/duplicated graph data.
      const { config } = await fetchLLMConfigAndTypes();
      const prompt = hasContext ? formatRAGPrompt(ragContext) : input;
      const requestId = crypto.randomUUID();

      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          prompt,
          systemPrompt: RAG_SYSTEM_PROMPT,
          messages: historyForLLM.length > 0 ? historyForLLM : undefined,
        },
      });

      const streamResult = await streamFromOffscreen(requestId, (chunk) => {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, content: m.content + chunk } : m
          )
        );
      });

      if (streamResult.error) {
        throw new Error(streamResult.error);
      }

      const finalContent = streamResult.content ?? '';
      updateMessage(assistantId, { content: finalContent, status: 'complete' });

      // Save assistant message to DB
      await chat.saveMessage({
        id: assistantId,
        sessionId,
        role: 'assistant',
        content: finalContent,
        ragContext: hasContext ? compactifyRAG(ragContext) : null,
        status: 'complete',
      });

      // Bump session activity
      await chat.touchSession(sessionId);

    } catch (e: any) {
      updateMessage(assistantId, {
        status: 'error',
        error: e.message || 'Query failed',
      });

      // Save error message to DB if we have a session
      if (sessionIdRef.current) {
        await chat.saveMessage({
          id: assistantId,
          sessionId: sessionIdRef.current,
          role: 'assistant',
          content: e.message || 'Query failed',
          status: 'error',
        }).catch(() => {});
      }
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, ensureSession]);

  const newSession = useCallback(async () => {
    if (sessionIdRef.current) {
      await chat.expireSession(sessionIdRef.current).catch(() => {});
    }
    sessionIdRef.current = null;
    setMessages([]);
    setIsProcessing(false);
  }, []);

  return { messages, sendMessage, newSession, isProcessing, sessionReady };
}

/** Parse compact RAG JSON back into a minimal RAGContext-like shape for display */
function parseCompactRAG(json: string): RAGContext | null {
  try {
    const compact: CompactRAGContext = JSON.parse(json);
    return {
      relevantNodes: compact.nodeLabels.map((name, i) => ({
        id: `restored-${i}`,
        name,
        type: '',
        identifier: '',
        properties: '{}',
        created_at: '',
        updated_at: '',
      })) as any[],
      relevantEdges: new Array(compact.edgeCount).fill(null) as any[],
      sourceExcerpts: compact.sourceUrls.map((url) => ({
        nodeId: '',
        nodeLabel: '',
        url,
        title: null,
        excerpt: '',
      })),
      query: '',
    };
  } catch {
    return null;
  }
}
