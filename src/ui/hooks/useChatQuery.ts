import { useState, useCallback } from 'react';
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

export function useChatQuery() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const updateMessage = (id: string, updates: Partial<ChatMessage>) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...updates } : m)));
  };

  const sendMessage = useCallback(async (input: string) => {
    if (isProcessing) return;
    setIsProcessing(true);

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
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
      await handleSmartQuery(assistantId, input);
    } catch (e: any) {
      updateMessage(assistantId, {
        status: 'error',
        error: e.message || 'Query failed',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing]);

  const handleSmartQuery = async (assistantId: string, input: string) => {
    // Step 1: Retrieve context from knowledge graph
    updateMessage(assistantId, { content: 'Searching knowledge graph...', status: 'executing' });

    const ragContext = await retrieveRAGContext(input);
    const hasContext = ragContext.relevantNodes.length > 0;

    // Step 2: Generate answer via LLM (with or without KG context)
    updateMessage(assistantId, {
      content: '',
      status: 'streaming',
      ragContext: hasContext ? ragContext : null,
    });

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
    updateMessage(assistantId, {
      content: finalContent,
      status: 'complete',
    });
  };

  const clearHistory = useCallback(() => {
    setMessages([]);
    setIsProcessing(false);
  }, []);

  return { messages, sendMessage, clearHistory, isProcessing };
}
