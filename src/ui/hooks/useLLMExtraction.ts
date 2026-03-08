import { useCallback } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useGraphStore } from '../../graph/store/graph-store';
import { useExtractionReviewStore, type ReviewNode, type ReviewEdge } from '../../graph/store/extraction-review-store';
import { extractionResultSchema } from '../../shared/schema';
import { entityResolution, sourceContent } from '../../db/client/db-client';
import type { DiffItem, AgentProgressEvent, EntityMatch } from '../../shared/types';

function streamFromOffscreen(
  requestId: string,
  onChunk: (text: string) => void
): Promise<{ content?: string; error?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('LLM stream timed out after 120s'));
    }, 120_000);

    const listener = (message: any) => {
      if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
      const { chunk, done, content, error } = message.payload;
      if (chunk) onChunk(chunk);
      if (done) {
        cleanup();
        resolve({ content, error });
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      chrome.runtime.onMessage.removeListener(listener);
    };

    chrome.runtime.onMessage.addListener(listener);
  });
}

async function buildDiffItems(
  validated: { nodes: Array<{ label: string; type: string; properties?: Record<string, unknown> }>; edges: Array<{ sourceLabel: string; targetLabel: string; label: string; type?: string }> }
): Promise<DiffItem[]> {
  const graph = useGraphStore.getState();
  const items: DiffItem[] = [];

  for (const node of validated.nodes) {
    // First try in-memory exact match
    const inMemoryMatch = graph.nodes.find(
      (n) => n.label.toLowerCase() === node.label.toLowerCase()
    );

    if (inMemoryMatch) {
      items.push({
        action: 'merge',
        type: 'node',
        extracted: node,
        existingMatch: inMemoryMatch,
        accepted: true,
      });
      continue;
    }

    // Try DB-level entity resolution (alias + fuzzy matching)
    try {
      const matches: EntityMatch[] = await entityResolution.findMatches(node.label);
      if (matches.length > 0) {
        const bestMatch = matches[0];
        const existingNode = graph.nodes.find((n) => n.id === bestMatch.nodeId);
        items.push({
          action: 'merge',
          type: 'node',
          extracted: node,
          existingMatch: existingNode ?? undefined,
          accepted: true,
        });
        continue;
      }
    } catch {
      // DB not ready or entity resolution failed, fall through to 'add'
    }

    items.push({
      action: 'add',
      type: 'node',
      extracted: node,
      accepted: true,
    });
  }

  for (const edge of validated.edges) {
    items.push({
      action: 'add',
      type: 'edge',
      extracted: edge,
      accepted: true,
    });
  }

  return items;
}

export function useLLMExtraction() {
  const startExtraction = useCallback(async (text: string, sourceUrl?: string) => {
    const llm = useLLMStore.getState();
    llm.setInputText(text);
    llm.setSourceUrl(sourceUrl ?? null);
    llm.setError(null);

    // Start agent run with steps
    const requestId = llm.startAgentRun([
      { id: 'extract', label: 'Extracting entities via LLM' },
      { id: 'parse', label: 'Parsing response' },
    ]);

    llm.setStatus('extracting');

    try {
      const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
      const config = result.llmConfig;
      if (!config?.apiKey) {
        throw new Error('No API key configured. Go to Settings to add one.');
      }

      // Send LLM_REQUEST with requestId — offscreen acks immediately
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          prompt: text,
        },
      });

      // Listen for stream chunks
      const streamResult = await streamFromOffscreen(requestId, (chunk) => {
        useLLMStore.getState().appendToCurrentStep(chunk);
      });

      if (streamResult.error) {
        throw new Error(streamResult.error);
      }

      // Complete extract step, advance to parse step
      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().advanceStep();

      // Get the content from the stream result or from the step output
      const content = streamResult.content
        ?? useLLMStore.getState().agentRun?.steps[0]?.output
        ?? '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = extractionResultSchema.parse(parsed);

      const items = await buildDiffItems(validated);

      // Complete parse step
      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().setDiff({ items });
      useLLMStore.getState().setStatus('extracted');
    } catch (e: any) {
      const llmState = useLLMStore.getState();
      llmState.failCurrentStep(e.message);
      llmState.setError(e.message);
    }
  }, []);

  const applyDiff = useCallback(async () => {
    const llm = useLLMStore.getState();
    const diff = llm.diff;
    if (!diff) return;

    llm.setStatus('merging');

    try {
      const graph = useGraphStore.getState();
      const nodeIdMap = new Map<string, string>();

      // First pass: create/merge nodes
      for (const item of diff.items) {
        if (!item.accepted || item.type !== 'node') continue;

        const extracted = item.extracted as { label: string; type: string; properties?: Record<string, unknown> };

        if (item.action === 'add') {
          const created = await graph.createNode({
            label: extracted.label,
            type: extracted.type,
            properties: extracted.properties,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
          if (created) {
            nodeIdMap.set(extracted.label.toLowerCase(), created.id);
          }
        } else if (item.existingMatch) {
          nodeIdMap.set(extracted.label.toLowerCase(), item.existingMatch.id);
          // Register the extracted label as an alias if it differs from the existing label
          if (extracted.label.toLowerCase() !== item.existingMatch.label.toLowerCase()) {
            try {
              await entityResolution.addAlias(item.existingMatch.id, extracted.label);
            } catch {
              // Alias may already exist, ignore
            }
          }
        }
      }

      // Second pass: create edges (re-read graph state to include newly created nodes)
      const updatedGraph = useGraphStore.getState();
      for (const item of diff.items) {
        if (!item.accepted || item.type !== 'edge') continue;

        const extracted = item.extracted as { sourceLabel: string; targetLabel: string; label: string; type?: string };

        const sourceId =
          nodeIdMap.get(extracted.sourceLabel.toLowerCase()) ??
          updatedGraph.nodes.find(
            (n) => n.label.toLowerCase() === extracted.sourceLabel.toLowerCase()
          )?.id;

        const targetId =
          nodeIdMap.get(extracted.targetLabel.toLowerCase()) ??
          updatedGraph.nodes.find(
            (n) => n.label.toLowerCase() === extracted.targetLabel.toLowerCase()
          )?.id;

        if (sourceId && targetId) {
          await updatedGraph.createEdge({
            sourceId,
            targetId,
            label: extracted.label,
            type: extracted.type,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
        }
      }

      // Save source content if we have text and a URL
      if (llm.sourceUrl && llm.inputText) {
        try {
          // Find or create the resource node for this URL
          const resourceNodeId = nodeIdMap.get(llm.sourceUrl.toLowerCase())
            ?? useGraphStore.getState().nodes.find(
              (n) => n.sourceUrl === llm.sourceUrl && n.type === 'resource'
            )?.id;

          await sourceContent.save({
            nodeId: resourceNodeId,
            url: llm.sourceUrl,
            content: llm.inputText,
          });
        } catch (e) {
          console.warn('[Extraction] Failed to save source content:', e);
        }
      }

      useLLMStore.getState().reset();
    } catch (e: any) {
      useLLMStore.getState().setError(e.message);
    }
  }, []);

  const startAgentExtraction = useCallback(async (prompt: string) => {
    const llm = useLLMStore.getState();
    llm.setError(null);
    llm.clearAgentTurns();

    // Get active tab
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    const tab = tabs[0];
    if (!tab?.id) {
      llm.setError('No active tab found');
      return;
    }

    // Get LLM config
    const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
    const config = result.llmConfig;
    if (!config?.apiKey) {
      llm.setError('No API key configured. Go to Settings to add one.');
      return;
    }
    if (config.provider !== 'anthropic') {
      llm.setError('Page extraction requires an Anthropic API key. Configure one in Settings.');
      return;
    }

    const runId = crypto.randomUUID();
    llm.setStatus('agent-running');
    llm.setSourceUrl(tab.url ?? null);

    // Send AGENT_RUN_START
    chrome.runtime.sendMessage({
      type: 'AGENT_RUN_START',
      payload: {
        runId,
        userPrompt: prompt,
        tabId: tab.id,
        provider: config.provider,
        model: config.model,
        apiKey: config.apiKey,
      },
    });

    // Listen for AGENT_PROGRESS events
    const listener = async (message: any) => {
      if (message.type !== 'AGENT_PROGRESS' || message.payload?.runId !== runId) return;

      const event: AgentProgressEvent = message.payload.event;
      const store = useLLMStore.getState();

      switch (event.type) {
        case 'llm_start':
          store.addAgentTurn({ type: 'thinking', content: '' });
          break;
        case 'llm_chunk':
          store.appendToLastTurn(event.text ?? '');
          break;
        case 'tool_call':
          if (event.toolCall) {
            store.addAgentTurn({
              type: 'tool_call',
              content: '',
              toolName: event.toolCall.name,
              toolInput: event.toolCall.input,
            });
          }
          break;
        case 'tool_result':
          store.addAgentTurn({
            type: 'tool_result',
            content: event.toolResult ?? event.toolError ?? '',
            toolName: event.toolCall?.name,
          });
          break;
        case 'extraction_complete': {
          chrome.runtime.onMessage.removeListener(listener);
          if (event.extractionResult) {
            const validated = extractionResultSchema.parse(event.extractionResult);
            const items = await buildDiffItems(validated);
            useLLMStore.getState().setDiff({ items });
            useLLMStore.getState().setStatus('extracted');
          }
          break;
        }
        case 'error':
          chrome.runtime.onMessage.removeListener(listener);
          useLLMStore.getState().setError(event.error ?? 'Agent loop failed');
          break;
        case 'done':
          chrome.runtime.onMessage.removeListener(listener);
          // If status is still agent-running (no extraction_complete), just finish
          if (useLLMStore.getState().status === 'agent-running') {
            useLLMStore.getState().setStatus('idle');
          }
          break;
      }
    };

    chrome.runtime.onMessage.addListener(listener);
  }, []);

  const proceedToReview = useCallback(async () => {
    const llm = useLLMStore.getState();
    const diff = llm.diff;
    if (!diff) return;

    const graph = useGraphStore.getState();
    const reviewNodes: ReviewNode[] = [];
    const reviewEdges: ReviewEdge[] = [];
    const labelToTempId = new Map<string, string>();

    // Convert node DiffItems → ReviewNodes
    for (const item of diff.items) {
      if (item.type !== 'node') continue;
      const extracted = item.extracted as { label: string; type: string; properties?: Record<string, unknown> };
      const tempId = `temp-${crypto.randomUUID()}`;
      labelToTempId.set(extracted.label.toLowerCase(), tempId);

      let mergeRecommendation: ReviewNode['mergeRecommendation'];

      if (item.action === 'merge' && item.existingMatch) {
        const existing = item.existingMatch as { id: string; label: string };
        mergeRecommendation = {
          existingNodeId: existing.id,
          existingLabel: existing.label,
          matchType: 'exact',
          similarity: 1,
          status: 'pending',
        };
      } else if (item.action === 'add') {
        // Try finding fuzzy matches for new nodes
        try {
          const matches: EntityMatch[] = await entityResolution.findMatches(extracted.label);
          if (matches.length > 0) {
            const best = matches[0];
            const existingNode = graph.nodes.find((n) => n.id === best.nodeId);
            if (existingNode) {
              mergeRecommendation = {
                existingNodeId: best.nodeId,
                existingLabel: best.label,
                matchType: best.matchType,
                similarity: best.similarity,
                status: 'pending',
              };
            }
          }
        } catch {
          // Entity resolution not available
        }
      }

      reviewNodes.push({
        tempId,
        label: extracted.label,
        type: extracted.type,
        properties: extracted.properties ?? {},
        mergeRecommendation,
        removed: false,
      });
    }

    // Convert edge DiffItems → ReviewEdges
    for (const item of diff.items) {
      if (item.type !== 'edge') continue;
      const extracted = item.extracted as { sourceLabel: string; targetLabel: string; label: string; type?: string };
      const sourceTempId = labelToTempId.get(extracted.sourceLabel.toLowerCase());
      const targetTempId = labelToTempId.get(extracted.targetLabel.toLowerCase());
      if (!sourceTempId || !targetTempId) continue;

      reviewEdges.push({
        tempId: `temp-${crypto.randomUUID()}`,
        sourceTempId,
        targetTempId,
        label: extracted.label,
        type: extracted.type ?? 'related_to',
        removed: false,
      });
    }

    useExtractionReviewStore.getState().initialize(reviewNodes, reviewEdges, llm.sourceUrl);
    useLLMStore.getState().setStatus('reviewing');
  }, []);

  const applyReview = useCallback(async () => {
    const llm = useLLMStore.getState();
    const reviewStore = useExtractionReviewStore.getState();
    const activeNodes = reviewStore.activeNodes();
    const activeEdges = reviewStore.activeEdges();

    if (activeNodes.length === 0 && activeEdges.length === 0) return;

    llm.setStatus('merging');

    try {
      const graph = useGraphStore.getState();
      const tempIdToRealId = new Map<string, string>();

      // First pass: create/merge nodes
      for (const node of activeNodes) {
        if (node.mergeRecommendation?.status === 'accepted') {
          // Merge: use existing node ID
          const existingId = node.mergeRecommendation.existingNodeId;
          tempIdToRealId.set(node.tempId, existingId);

          // Register alias if labels differ
          if (node.label.toLowerCase() !== node.mergeRecommendation.existingLabel.toLowerCase()) {
            try {
              await entityResolution.addAlias(existingId, node.label);
            } catch {
              // Alias may already exist
            }
          }

          // Merge properties into existing node
          if (Object.keys(node.properties).length > 0) {
            const existing = graph.nodes.find((n) => n.id === existingId);
            if (existing) {
              await graph.updateNode({
                id: existingId,
                properties: { ...existing.properties, ...node.properties },
              });
            }
          }
        } else {
          // New node: create it
          const created = await graph.createNode({
            label: node.label,
            type: node.type,
            properties: node.properties,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
          if (created) {
            tempIdToRealId.set(node.tempId, created.id);
          }
        }
      }

      // Second pass: create edges
      const updatedGraph = useGraphStore.getState();
      const allReviewTempIds = new Set(reviewStore.nodes.map((n) => n.tempId));

      for (const edge of activeEdges) {
        const resolveEndpoint = (id: string): string | undefined => {
          // 1. Check if it was mapped during node creation/merge
          const mapped = tempIdToRealId.get(id);
          if (mapped) return mapped;

          // 2. If it's not a review node ID, it's already an existing graph node ID
          if (!allReviewTempIds.has(id)) {
            // Verify the node exists
            if (updatedGraph.nodes.some((n) => n.id === id)) return id;
            return undefined;
          }

          // 3. Fall back to label matching
          const reviewNode = reviewStore.nodes.find((rn) => rn.tempId === id);
          if (!reviewNode) return undefined;
          return updatedGraph.nodes.find(
            (n) => n.label.toLowerCase() === reviewNode.label.toLowerCase()
          )?.id;
        };

        const sourceId = resolveEndpoint(edge.sourceTempId);
        const targetId = resolveEndpoint(edge.targetTempId);

        if (sourceId && targetId) {
          await updatedGraph.createEdge({
            sourceId,
            targetId,
            label: edge.label,
            type: edge.type,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
        }
      }

      // Save source content
      if (llm.sourceUrl && llm.inputText) {
        try {
          const resourceNodeId = useGraphStore.getState().nodes.find(
            (n) => n.sourceUrl === llm.sourceUrl && n.type === 'resource'
          )?.id;

          await sourceContent.save({
            nodeId: resourceNodeId,
            url: llm.sourceUrl,
            content: llm.inputText,
          });
        } catch (e) {
          console.warn('[Extraction] Failed to save source content:', e);
        }
      }

      useExtractionReviewStore.getState().reset();
      useLLMStore.getState().reset();
    } catch (e: any) {
      useLLMStore.getState().setError(e.message);
    }
  }, []);

  return { startExtraction, startAgentExtraction, applyDiff, applyReview, proceedToReview };
}
