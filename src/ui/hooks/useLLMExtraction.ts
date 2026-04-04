import { useCallback } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useGraphStore } from '../../graph/store/graph-store';
import { useExtractionReviewStore, type ReviewNode, type ReviewEdge } from '../../graph/store/extraction-review-store';
import { extractionResultSchema } from '../../shared/schema';
import { computeCostCents } from '../../shared/constants';
import { entityResolution, sourceContent, conceptSources } from '../../db/client/db-client';
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
      const { chunk, done, content, error, inputTokens, outputTokens, model } = message.payload;
      if (chunk) onChunk(chunk);
      if (done) {
        cleanup();
        if (inputTokens != null && model) {
          const costCents = computeCostCents(model, inputTokens, outputTokens ?? 0);
          useLLMStore.getState().setLastUsage({ inputTokens, outputTokens: outputTokens ?? 0, costCents });
        }
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

export async function buildDiffItems(
  validated: { nodes: Array<{ name: string; type: string; properties?: Record<string, unknown>; tags?: string[] }>; edges: Array<{ sourceName: string; targetName: string; label: string; type?: string }> }
): Promise<DiffItem[]> {
  const graph = useGraphStore.getState();

  // Resolve all nodes in parallel to avoid sequential DB round-trips
  const nodeItems = await Promise.all(validated.nodes.map(async (node): Promise<DiffItem> => {
    // First try in-memory exact match
    const inMemoryMatch = graph.nodes.find(
      (n) => n.name.toLowerCase() === node.name.toLowerCase()
    );

    if (inMemoryMatch) {
      return { action: 'merge', type: 'node', extracted: node, existingMatch: inMemoryMatch, accepted: true };
    }

    // Try DB-level entity resolution (alias + fuzzy matching)
    try {
      const matches: EntityMatch[] = await entityResolution.findMatches(node.name);
      if (matches.length > 0) {
        const bestMatch = matches[0];
        const existingNode = graph.nodes.find((n) => n.id === bestMatch.nodeId);
        return { action: 'merge', type: 'node', extracted: node, existingMatch: existingNode ?? undefined, accepted: true };
      }
    } catch {
      // DB not ready or entity resolution failed, fall through to 'add'
    }

    return { action: 'add', type: 'node', extracted: node, accepted: true };
  }));

  const edgeItems: DiffItem[] = validated.edges.map((edge) => ({
    action: 'add',
    type: 'edge',
    extracted: edge,
    accepted: true,
  }));

  return [...nodeItems, ...edgeItems];
}

export function useLLMExtraction() {
  const startExtraction = useCallback(async (text: string, sourceUrl?: string) => {
    // Privacy disclosure gate
    const disc = await chrome.storage.local.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startExtraction(text, sourceUrl));
      return;
    }

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

      // Send LLM_REQUEST with requestId — offscreen reads apiKey from storage directly
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
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

        const extracted = item.extracted as { name: string; type: string; properties?: Record<string, unknown>; tags?: string[] };

        if (item.action === 'add') {
          const created = await graph.createNode({
            name: extracted.name,
            type: extracted.type,
            properties: extracted.properties,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
          if (created) {
            nodeIdMap.set(extracted.name.toLowerCase(), created.id);
          }
        } else if (item.existingMatch) {
          nodeIdMap.set(extracted.name.toLowerCase(), item.existingMatch.id);
          // Register the extracted name as an alias if it differs from the existing name
          if (extracted.name.toLowerCase() !== (item.existingMatch as { id: string; name: string }).name.toLowerCase()) {
            try {
              await entityResolution.addAlias(item.existingMatch.id, extracted.name);
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

        const extracted = item.extracted as { sourceName: string; targetName: string; label: string; type?: string };

        const sourceId =
          nodeIdMap.get(extracted.sourceName.toLowerCase()) ??
          updatedGraph.nodes.find(
            (n) => n.name.toLowerCase() === extracted.sourceName.toLowerCase()
          )?.id;

        const targetId =
          nodeIdMap.get(extracted.targetName.toLowerCase()) ??
          updatedGraph.nodes.find(
            (n) => n.name.toLowerCase() === extracted.targetName.toLowerCase()
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

      // Link concept nodes to their source resource (parallelized per Pitfall #20)
      if (llm.sourceUrl) {
        const resourceNode = useGraphStore.getState().nodes.find(
          (n) => n.sourceUrl === llm.sourceUrl && n.type === 'resource'
        );
        const resourceIdentifier = resourceNode?.identifier;
        if (resourceIdentifier) {
          const conceptNodeIds: string[] = [];
          for (const item of diff.items) {
            if (!item.accepted || item.type !== 'node') continue;
            const extracted = item.extracted as { name: string; type: string };
            if (extracted.type === 'concept') {
              const realId = nodeIdMap.get(extracted.name.toLowerCase())
                ?? item.existingMatch?.id;
              if (realId) conceptNodeIds.push(realId);
            }
          }
          if (conceptNodeIds.length > 0) {
            await Promise.all(
              conceptNodeIds.map((id) =>
                conceptSources.addSource(id, resourceIdentifier).catch(() => {
                  // Best-effort: source link may already exist
                })
              )
            );
          }
        }
      }

      useLLMStore.getState().reset();
    } catch (e: any) {
      useLLMStore.getState().setError(e.message);
    }
  }, []);

  const startAgentExtraction = useCallback(async (prompt: string) => {
    // Privacy disclosure gate
    const disc = await chrome.storage.local.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startAgentExtraction(prompt));
      return;
    }

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

    // Send AGENT_RUN_START — offscreen reads apiKey from storage directly
    chrome.runtime.sendMessage({
      type: 'AGENT_RUN_START',
      payload: {
        runId,
        userPrompt: prompt,
        tabId: tab.id,
        provider: config.provider,
        model: config.model,
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
          if (event.inputTokens != null && event.model) {
            const costCents = computeCostCents(event.model, event.inputTokens, event.outputTokens ?? 0);
            useLLMStore.getState().setLastUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens ?? 0, costCents });
          }
          if (event.extractionResult) {
            try {
              const validated = extractionResultSchema.parse(event.extractionResult);
              const items = await buildDiffItems(validated);
              useLLMStore.getState().setDiff({ items });
              useLLMStore.getState().setStatus('extracted');
            } catch (e: any) {
              useLLMStore.getState().setError(`Failed to parse extraction result: ${e.message}`);
            }
          }
          break;
        }
        case 'error':
          chrome.runtime.onMessage.removeListener(listener);
          useLLMStore.getState().setError(event.error ?? 'Agent loop failed');
          break;
        case 'done':
          chrome.runtime.onMessage.removeListener(listener);
          // If status is still agent-running, agent finished without calling save_entities
          if (useLLMStore.getState().status === 'agent-running') {
            useLLMStore.getState().setError('Agent finished without extracting any entities. Try a more specific prompt.');
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
    const nameToTempId = new Map<string, string>();

    // Convert node DiffItems → ReviewNodes (resolve fuzzy matches in parallel)
    const nodeItems = diff.items.filter(item => item.type === 'node');
    const resolvedNodes = await Promise.all(nodeItems.map(async (item) => {
      const extracted = item.extracted as { name: string; type: string; properties?: Record<string, unknown>; tags?: string[] };
      const tempId = `temp-${crypto.randomUUID()}`;

      let mergeRecommendation: ReviewNode['mergeRecommendation'];

      if (item.action === 'merge' && item.existingMatch) {
        const existing = item.existingMatch as { id: string; name: string };
        mergeRecommendation = {
          existingNodeId: existing.id,
          existingName: existing.name,
          matchType: 'exact',
          similarity: 1,
          status: 'pending',
        };
      } else if (item.action === 'add') {
        try {
          const matches: EntityMatch[] = await entityResolution.findMatches(extracted.name);
          if (matches.length > 0) {
            const best = matches[0];
            const existingNode = graph.nodes.find((n) => n.id === best.nodeId);
            if (existingNode) {
              mergeRecommendation = {
                existingNodeId: best.nodeId,
                existingName: best.name,
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

      return { tempId, name: extracted.name, type: extracted.type, properties: extracted.properties ?? {}, tags: extracted.tags ?? [], mergeRecommendation, removed: false } as ReviewNode;
    }));

    for (const node of resolvedNodes) {
      nameToTempId.set(node.name.toLowerCase(), node.tempId);
      reviewNodes.push(node);
    }

    // Convert edge DiffItems → ReviewEdges
    for (const item of diff.items) {
      if (item.type !== 'edge') continue;
      const extracted = item.extracted as { sourceName: string; targetName: string; label: string; type?: string };
      const sourceTempId = nameToTempId.get(extracted.sourceName.toLowerCase());
      const targetTempId = nameToTempId.get(extracted.targetName.toLowerCase());
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

          // Register alias if names differ
          if (node.name.toLowerCase() !== node.mergeRecommendation.existingName.toLowerCase()) {
            try {
              await entityResolution.addAlias(existingId, node.name);
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
            name: node.name,
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

          // 3. Fall back to name matching
          const reviewNode = reviewStore.nodes.find((rn) => rn.tempId === id);
          if (!reviewNode) return undefined;
          return updatedGraph.nodes.find(
            (n) => n.name.toLowerCase() === reviewNode.name.toLowerCase()
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

      // Link concept nodes to their source resource (parallelized per Pitfall #20)
      if (llm.sourceUrl) {
        const resourceNode = useGraphStore.getState().nodes.find(
          (n) => n.sourceUrl === llm.sourceUrl && n.type === 'resource'
        );
        const resourceIdentifier = resourceNode?.identifier;
        if (resourceIdentifier) {
          const conceptNodeIds: string[] = [];
          for (const node of activeNodes) {
            if (node.type === 'concept') {
              const realId = tempIdToRealId.get(node.tempId);
              if (realId) conceptNodeIds.push(realId);
            }
          }
          if (conceptNodeIds.length > 0) {
            await Promise.all(
              conceptNodeIds.map((id) =>
                conceptSources.addSource(id, resourceIdentifier).catch(() => {
                  // Best-effort: source link may already exist
                })
              )
            );
          }
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
