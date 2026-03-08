import { useState, useCallback } from 'react';
import { graph } from '../../db/client/db-client';
import { buildNLQuerySystemPrompt } from '../components/query/nl-query-prompt';
import { streamFromOffscreen, fetchLLMConfigAndTypes, parseJsonFromLLMResponse } from './nl-query-utils';
import { retrieveRAGContext, formatRAGPrompt, RAG_SYSTEM_PROMPT, type RAGContext } from './rag-pipeline';
import type { QueryResult } from '../../db/worker/query-engine/types';

export type ChatMode = 'smart' | 'dsl';
type MessageStatus = 'complete' | 'streaming' | 'executing' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  generatedJson?: string;
  results?: QueryResult | null;
  ragContext?: RAGContext | null;
  error?: string;
  status: MessageStatus;
  mode?: ChatMode;
}

export function useChatQuery() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [mode, setMode] = useState<ChatMode>('smart');

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
      mode,
    };

    const assistantId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      mode,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    try {
      if (mode === 'smart') {
        await handleSmartQuery(assistantId, input);
      } else {
        await handleDSLQuery(assistantId, input);
      }
    } catch (e: any) {
      updateMessage(assistantId, {
        status: 'error',
        error: e.message || 'Query failed',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [isProcessing, mode]);

  const handleSmartQuery = async (assistantId: string, input: string) => {
    // Step 1: Retrieve context from knowledge graph
    updateMessage(assistantId, { content: 'Searching knowledge graph...', status: 'executing' });

    const ragContext = await retrieveRAGContext(input);

    if (ragContext.relevantNodes.length === 0) {
      updateMessage(assistantId, {
        content: 'No relevant information found in your knowledge graph for this question.',
        status: 'complete',
        ragContext,
      });
      return;
    }

    // Step 2: Generate answer via LLM
    updateMessage(assistantId, { content: '', status: 'streaming', ragContext });

    const { config } = await fetchLLMConfigAndTypes();
    const ragPrompt = formatRAGPrompt(ragContext);
    const requestId = crypto.randomUUID();

    chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      requestId,
      payload: {
        provider: config.provider,
        model: config.model,
        prompt: ragPrompt,
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

  const handleDSLQuery = async (assistantId: string, input: string) => {
    const { nodeTypesList, edgeTypesList, config } = await fetchLLMConfigAndTypes();
    const systemPrompt = buildNLQuerySystemPrompt(nodeTypesList, edgeTypesList);
    const requestId = crypto.randomUUID();

    chrome.runtime.sendMessage({
      type: 'LLM_REQUEST',
      requestId,
      payload: {
        provider: config.provider,
        model: config.model,
        prompt: input,
        systemPrompt,
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

    const content = streamResult.content ?? '';
    const { rawJson, validated } = parseJsonFromLLMResponse(content);

    updateMessage(assistantId, { status: 'executing', generatedJson: rawJson });

    const result = await graph.query(validated) as QueryResult;
    updateMessage(assistantId, { status: 'complete', results: result });
  };

  const clearHistory = useCallback(() => {
    setMessages([]);
    setIsProcessing(false);
  }, []);

  return { messages, sendMessage, clearHistory, isProcessing, mode, setMode };
}
