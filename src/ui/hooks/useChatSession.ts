import { useState, useCallback, useEffect, useRef } from 'react';
import { chat, memory as memoryDb } from '../../db/client/db-client';
import { storage } from '@platform';
import { fetchLLMConfigAndTypes } from './nl-query-utils';
import { runChatAgent, type ChatAgentTurn, type ChatAgentProgress, type ChatSubgraphData } from './chat-agent-loop';
import { assembleSystemPrompt } from '../../core/prompt-assembler';
import { extractSemanticMemories } from '../../core/memory-extractor';

type MessageStatus = 'complete' | 'streaming' | 'executing' | 'error';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  agentTurns?: ChatAgentTurn[];
  subgraph?: ChatSubgraphData;
  error?: string;
  status: MessageStatus;
}

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

      // Load conversation history for multi-turn context
      const recentMessages = await chat.getRecentMessages(sessionId, 20);
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

      // Get LLM config
      updateMessage(assistantId, { content: '', status: 'executing' });
      const { config } = await fetchLLMConfigAndTypes();

      // Assemble system prompt with harness context
      const storageData = await storage.get(['harnessGlobalInstructions', 'harnessPresets', 'harnessActivePresetId']);
      const globalInstructions = (storageData as any).harnessGlobalInstructions ?? null;
      const presets = (storageData as any).harnessPresets ?? [];
      const activePresetId = (storageData as any).harnessActivePresetId ?? null;
      const activePreset = activePresetId
        ? presets.find((p: any) => p.id === activePresetId)
        : null;

      const semanticMemories = await memoryDb.getRecentSemantic(20) as Array<{ category: string; content: string }>;
      const episodicSummaries = await memoryDb.getRecentEpisodic(3) as Array<{ summary: string }>;

      const systemPrompt = assembleSystemPrompt({
        globalInstructions,
        presetPrompt: activePreset?.prompt ?? null,
        presetName: activePreset?.name ?? null,
        semanticMemories,
        recentSessionSummaries: episodicSummaries,
      });

      // Run agentic chat loop
      updateMessage(assistantId, { content: '', status: 'streaming', agentTurns: [] });

      const finalText = await runChatAgent({
        conversationHistory: historyForLLM,
        currentPrompt: input,
        provider: config.provider,
        model: config.model,
        systemPrompt,
        onProgress: (event: ChatAgentProgress) => {
          switch (event.type) {
            case 'text_chunk':
              if (event.textChunk) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, content: m.content + event.textChunk }
                      : m
                  )
                );
              }
              break;
            case 'turn':
              if (event.turn) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, agentTurns: [...(m.agentTurns ?? []), event.turn!] }
                      : m
                  )
                );
              }
              break;
            case 'done':
              // Attach subgraph data for referenced entities display
              if (event.subgraph) {
                updateMessage(assistantId, { subgraph: event.subgraph });
              }
              break;
            case 'error':
              // Error will be thrown and caught by the outer catch
              break;
          }
        },
      });

      updateMessage(assistantId, { content: finalText, status: 'complete' });

      // Save assistant message to DB (final text only, no tool call details)
      await chat.saveMessage({
        id: assistantId,
        sessionId,
        role: 'assistant',
        content: finalText,
        status: 'complete',
      });

      // Fire-and-forget: extract semantic memories from this exchange
      extractSemanticMemories(input, finalText, sessionId).catch(() => {});

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

  const loadSession = useCallback(async (sessionId: string) => {
    sessionIdRef.current = sessionId;
    const dbMessages = await chat.getMessages(sessionId);
    const restored: ChatMessage[] = dbMessages.map((m: any) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      status: m.status as MessageStatus,
    }));
    setMessages(restored);
    setIsProcessing(false);
  }, []);

  const currentSessionId = sessionIdRef.current;

  return { messages, sendMessage, newSession, loadSession, currentSessionId, isProcessing, sessionReady };
}
