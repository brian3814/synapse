import { useState, useCallback } from 'react';
import { graph } from '../../db/client/db-client';
import { buildNLQuerySystemPrompt } from '../components/query/nl-query-prompt';
import { streamFromOffscreen, fetchLLMConfigAndTypes, parseJsonFromLLMResponse } from './nl-query-utils';
import type { QueryResult } from '../../db/worker/query-engine/types';

type NLQueryStatus = 'idle' | 'streaming' | 'executing' | 'done' | 'error';

export function useNLQuery() {
  const [status, setStatus] = useState<NLQueryStatus>('idle');
  const [streamText, setStreamText] = useState('');
  const [generatedJson, setGeneratedJson] = useState<string | null>(null);
  const [results, setResults] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const execute = useCallback(async (input: string) => {
    setStatus('streaming');
    setStreamText('');
    setGeneratedJson(null);
    setResults(null);
    setError(null);

    try {
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
        setStreamText((prev) => prev + chunk);
      });

      if (streamResult.error) {
        throw new Error(streamResult.error);
      }

      const content = streamResult.content ?? '';
      const { rawJson, validated } = parseJsonFromLLMResponse(content);
      setGeneratedJson(rawJson);

      setStatus('executing');
      const result = await graph.query(validated) as QueryResult;
      setResults(result);
      setStatus('done');
    } catch (e: any) {
      setError(e.message || 'Query failed');
      setStatus('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStatus('idle');
    setStreamText('');
    setGeneratedJson(null);
    setResults(null);
    setError(null);
  }, []);

  return { status, streamText, generatedJson, results, error, execute, reset };
}
