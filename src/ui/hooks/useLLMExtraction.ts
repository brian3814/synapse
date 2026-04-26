import { useCallback } from 'react';
import { useLLMStore } from '../../graph/store/llm-store';
import { useGraphStore } from '../../graph/store/graph-store';
import { useExtractionReviewStore, type ReviewNode, type ReviewEdge, type ReviewNote } from '../../graph/store/extraction-review-store';
import { extractionResultSchema } from '../../shared/schema';
import { computeCostCents } from '../../shared/constants';
import { getQuickExtractSystemPrompt } from '../../shared/quick-extract-prompt';

const EXTRACTION_NOTES_ENABLED_KEY = 'extractionNotesEnabled';

/** Read the persisted notes-toggle setting. Defaults to false (off). */
async function isNotesEnabled(): Promise<boolean> {
  try {
    const stored = await chrome.storage.local.get(EXTRACTION_NOTES_ENABLED_KEY) as Record<string, any>;
    return Boolean(stored[EXTRACTION_NOTES_ENABLED_KEY]);
  } catch {
    return false;
  }
}
import { entityResolution, sourceContent, entitySources, edgeSources, noteSearch } from '../../db/client/db-client';
import { write as writeNote } from '../../notes/note-store';
import { generateNoteMarkdown } from '../../notes/markdown-utils';
import { stripMarkdownToPlainText } from '../../notes/markdown-utils';
import { parseMarkdown } from '../../filesystem/markdown-parser';
import type { DiffItem, ExtractedNoteCandidate, AgentProgressEvent, EntityMatch } from '../../shared/types';

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
      if (message.type === 'RATE_LIMIT_WAIT' && message.payload?.requestId === requestId) {
        useLLMStore.getState().setRateLimitWait({
          retryAfterMs: message.payload.retryAfterMs,
          startedAt: Date.now(),
          retryCount: message.payload.retryCount,
          maxRetries: message.payload.maxRetries,
        });
        return;
      }

      if (message.type !== 'LLM_STREAM_CHUNK' || message.payload?.requestId !== requestId) return;
      const { chunk, done, content, error, errorType, inputTokens, outputTokens, model } = message.payload;
      if (chunk) onChunk(chunk);
      if (done) {
        // Rate-limit errors are retried by the service worker — don't resolve yet
        if (error && (errorType === 'rate_limit' || errorType === 'overloaded')) return;

        cleanup();
        useLLMStore.getState().setRateLimitWait(null);
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

/**
 * Normalizes an LLM-extracted node to the three-layer model:
 * - Filters out any `type='resource'` outputs (resources are system-created)
 * - Treats everything else as an entity: `type='entity'` with a semantic `label`
 * - Back-compat: `type='concept'` (legacy) becomes `label='concept'`
 */
interface NormalizedExtractedNode {
  name: string;
  type: 'entity';
  label: string;
  properties?: Record<string, unknown>;
  tags?: string[];
}

function normalizeExtractedNode(raw: {
  name: string;
  type?: string;
  label?: string;
  properties?: Record<string, unknown>;
  tags?: string[];
}): NormalizedExtractedNode | null {
  const rawType = (raw.type ?? '').toLowerCase().trim();
  if (rawType === 'resource') return null; // system-owned; drop

  // If the LLM still outputs a legacy semantic type (e.g. 'concept', 'person'),
  // promote it to a label on the 'entity' layer.
  let label = raw.label?.trim();
  if (!label) {
    if (rawType && rawType !== 'entity' && rawType !== 'note') {
      label = rawType;
    } else {
      label = 'concept';
    }
  }

  // Note: extraction produces entities, not notes. Note creation is a Phase 4
  // feature gated by the extractionNotesEnabled toggle.
  return {
    name: raw.name,
    type: 'entity',
    label,
    properties: raw.properties,
    tags: raw.tags,
  };
}

/**
 * Ensures a resource node exists for the given URL. Resource nodes are
 * system-owned in the three-layer model: they are created deterministically
 * at merge time (never by the LLM), guaranteeing the provenance chain is
 * always intact. Re-uses an existing resource node if one is already present
 * for the URL.
 */
export async function ensureResourceNode(
  sourceUrl: string,
  title?: string | null
): Promise<{ id: string; identifier: string | null; sourceUrl: string } | null> {
  const graph = useGraphStore.getState();

  // In-memory lookup (fast path)
  const existing = graph.nodes.find(
    (n) => n.type === 'resource' && n.sourceUrl === sourceUrl
  );
  if (existing) return { id: existing.id, identifier: existing.identifier, sourceUrl };

  // Not in memory — create it. createNode is idempotent via identifier
  // (generateIdentifier produces a stable slug from the URL).
  let displayName = title?.trim();
  if (!displayName) {
    try {
      const u = new URL(sourceUrl);
      displayName = u.hostname + u.pathname;
    } catch {
      displayName = sourceUrl;
    }
  }

  const created = await graph.createNode({
    name: displayName,
    type: 'resource',
    properties: {},
    sourceUrl,
  });
  if (!created) return null;
  return { id: created.id, identifier: created.identifier, sourceUrl };
}

export async function buildDiffItems(
  validated: {
    nodes: Array<{
      name: string;
      type?: string;
      label?: string;
      properties?: Record<string, unknown>;
      tags?: string[];
    }>;
    edges: Array<{ sourceName: string; targetName: string; label: string; type?: string }>;
    notes?: Array<{
      title: string;
      content: string;
      about?: string[];
      mentions?: string[];
    }>;
  }
): Promise<{ items: DiffItem[]; notes: ExtractedNoteCandidate[] }> {
  const graph = useGraphStore.getState();

  // Normalize first, filter out resource nodes (system-created).
  const normalizedNodes = validated.nodes
    .map(normalizeExtractedNode)
    .filter((n): n is NormalizedExtractedNode => n !== null);

  // Resolve all nodes in parallel to avoid sequential DB round-trips
  const nodeItems = await Promise.all(normalizedNodes.map(async (node): Promise<DiffItem> => {
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

  const notes: ExtractedNoteCandidate[] = (validated.notes ?? []).map((n) => ({
    title: n.title,
    content: n.content,
    about: n.about ?? [],
    mentions: n.mentions ?? [],
  }));

  return { items: [...nodeItems, ...edgeItems], notes };
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

      const notesOn = await isNotesEnabled();

      // Send LLM_REQUEST with requestId — offscreen reads apiKey from storage directly
      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          prompt: text,
          systemPrompt: getQuickExtractSystemPrompt(notesOn),
          notesEnabled: notesOn,
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

      const { items, notes } = await buildDiffItems(validated);

      // Complete parse step
      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().setDiff({ items, notes });
      useLLMStore.getState().setStatus('extracted');
    } catch (e: any) {
      const llmState = useLLMStore.getState();
      llmState.failCurrentStep(e.message);
      llmState.setError(e.message);
    }
  }, []);

  const startQuickExtraction = useCallback(async (prompt?: string, sourceUrl?: string) => {
    // Privacy disclosure gate
    const disc = await chrome.storage.local.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startQuickExtraction(prompt, sourceUrl));
      return;
    }

    const llm = useLLMStore.getState();
    llm.setError(null);

    // Get LLM config
    const result = await chrome.storage.local.get('llmConfig') as Record<string, any>;
    const config = result.llmConfig;
    if (!config?.apiKey) {
      llm.setError('No API key configured. Go to Settings to add one.');
      return;
    }

    // Fetch page content: from custom URL or current tab
    let pageContent: { title: string; url: string; content: string };
    if (sourceUrl) {
      try {
        const resp = await fetch(sourceUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const html = await resp.text();
        const { htmlToMarkdown } = await import('../../shared/html-to-markdown');
        const markdown = htmlToMarkdown(html).replace(/\n{3,}/g, '\n\n');
        const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
        pageContent = {
          title: titleMatch?.[1]?.trim() ?? sourceUrl,
          url: sourceUrl,
          content: markdown.length > 50_000 ? markdown.substring(0, 50_000) + '\n\n...[truncated]' : markdown,
        };
      } catch (e: any) {
        llm.setError(`Failed to fetch URL: ${e.message}`);
        return;
      }
    } else {
      try {
        pageContent = await chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT_QUICK' }) as any;
        if (!pageContent?.content) throw new Error('No page content received');
      } catch (e: any) {
        llm.setError(`Failed to get page content: ${e.message}`);
        return;
      }
    }

    llm.setInputText(pageContent.content);
    llm.setSourceUrl(pageContent.url);

    const requestId = llm.startAgentRun([
      { id: 'extract', label: 'Quick extracting entities via LLM' },
      { id: 'parse', label: 'Parsing response' },
    ]);

    llm.setStatus('extracting');

    const notesOn = await isNotesEnabled();

    try {
      const userContent = prompt
        ? `${prompt}\n\n---\n\nPage content:\n\n${pageContent.content}`
        : `Extract entities and relationships from the following web page:\n\n${pageContent.content}`;

      chrome.runtime.sendMessage({
        type: 'LLM_REQUEST',
        requestId,
        payload: {
          provider: config.provider,
          model: config.model,
          prompt: userContent,
          systemPrompt: getQuickExtractSystemPrompt(notesOn),
          notesEnabled: notesOn,
        },
      });

      const streamResult = await streamFromOffscreen(requestId, (chunk) => {
        useLLMStore.getState().appendToCurrentStep(chunk);
      });

      if (streamResult.error) throw new Error(streamResult.error);

      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().advanceStep();

      const content = streamResult.content
        ?? useLLMStore.getState().agentRun?.steps[0]?.output
        ?? '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in LLM response');

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = extractionResultSchema.parse(parsed);
      const { items, notes } = await buildDiffItems(validated);

      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().setDiff({ items, notes });
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
            sourceUrl: llm.sourceUrl ?? undefined,
            skipProvenance: true,
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

      // Link entity nodes to their source resource (parallelized per Pitfall #20).
      // The three-layer model tracks this in entity_sources with a relation_type
      // distinction (about/mention). Direct extraction without notes defaults to 'about'.
      if (llm.sourceUrl) {
        const resourceNode = useGraphStore.getState().nodes.find(
          (n) => n.sourceUrl === llm.sourceUrl && n.type === 'resource'
        );
        if (resourceNode) {
          const entityNodeIds: string[] = [];
          for (const item of diff.items) {
            if (!item.accepted || item.type !== 'node') continue;
            const extracted = item.extracted as { name: string; type: string };
            if (extracted.type === 'entity' || extracted.type === 'concept') {
              const realId = nodeIdMap.get(extracted.name.toLowerCase())
                ?? item.existingMatch?.id;
              if (realId) entityNodeIds.push(realId);
            }
          }
          if (entityNodeIds.length > 0) {
            await Promise.all(
              entityNodeIds.map((id) =>
                entitySources.add(id, resourceNode.id, 'about').catch(() => {
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

  const startAgentExtraction = useCallback(async (prompt?: string, sourceUrl?: string) => {
    // Privacy disclosure gate
    const disc = await chrome.storage.local.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startAgentExtraction(prompt, sourceUrl));
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
    llm.setSourceUrl(sourceUrl ?? tab.url ?? null);

    const notesOn = await isNotesEnabled();

    // Build agent prompt: include custom URL if provided, so the agent
    // uses fetch_url to retrieve it instead of reading the active tab.
    let agentPrompt = prompt || 'Extract entities and relationships from this page.';
    if (sourceUrl) {
      agentPrompt = `${agentPrompt}\n\nIMPORTANT: Extract from this URL instead of the current tab: ${sourceUrl}\nUse fetch_url to retrieve its content.`;
    }

    // Send AGENT_RUN_START — offscreen reads apiKey from storage directly
    chrome.runtime.sendMessage({
      type: 'AGENT_RUN_START',
      payload: {
        runId,
        userPrompt: agentPrompt,
        tabId: tab.id,
        provider: config.provider,
        model: config.model,
        notesEnabled: notesOn,
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
              const { items, notes } = await buildDiffItems(validated);
              useLLMStore.getState().setDiff({ items, notes });
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
      const extracted = item.extracted as {
        name: string;
        type: string;
        label?: string;
        properties?: Record<string, unknown>;
        tags?: string[];
      };
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

      return {
        tempId,
        name: extracted.name,
        type: extracted.type,
        label: extracted.label,
        properties: extracted.properties ?? {},
        tags: extracted.tags ?? [],
        mergeRecommendation,
        removed: false,
      } as ReviewNode;
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

    // Convert extracted notes → ReviewNotes, resolving entity names to
    // review temp IDs via the nameToTempId map built above.
    const reviewNotes: ReviewNote[] = [];
    for (const extractedNote of diff.notes ?? []) {
      const about: string[] = [];
      const mentions: string[] = [];
      for (const entityName of extractedNote.about) {
        const tempId = nameToTempId.get(entityName.toLowerCase());
        if (tempId) about.push(tempId);
      }
      for (const entityName of extractedNote.mentions) {
        const tempId = nameToTempId.get(entityName.toLowerCase());
        if (tempId && !about.includes(tempId)) mentions.push(tempId);
      }
      // Skip notes that bind to no entities (nothing to attach to)
      if (about.length === 0 && mentions.length === 0) continue;

      reviewNotes.push({
        tempId: `temp-${crypto.randomUUID()}`,
        title: extractedNote.title,
        content: extractedNote.content,
        about,
        mentions,
        removed: false,
      });
    }

    useExtractionReviewStore
      .getState()
      .initialize(reviewNodes, reviewEdges, reviewNotes, llm.sourceUrl);
    useLLMStore.getState().setStatus('reviewing');
  }, []);

  const applyReview = useCallback(async () => {
    const llm = useLLMStore.getState();
    const reviewStore = useExtractionReviewStore.getState();
    const activeNodes = reviewStore.activeNodes();
    const activeEdges = reviewStore.activeEdges();

    const activeReviewNotes = reviewStore.activeNotes();

    if (
      activeNodes.length === 0 &&
      activeEdges.length === 0 &&
      activeReviewNotes.length === 0
    ) {
      return;
    }

    llm.setStatus('merging');

    try {
      const graph = useGraphStore.getState();
      const tempIdToRealId = new Map<string, string>();

      // Pass 0: deterministically ensure a resource node exists for this source URL.
      // In the three-layer model, resources are system-owned — the LLM never emits
      // them, and the merge always anchors its provenance to a real resource node.
      let resourceNode: { id: string; identifier: string | null; sourceUrl: string } | null = null;
      if (llm.sourceUrl) {
        resourceNode = await ensureResourceNode(llm.sourceUrl);
      }

      // First pass: create/merge entity nodes (and any other non-resource nodes)
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
          // New node: create it. Resources are never in the review; the LLM is
          // prompted to only emit entities (and notes, when that Phase 4 toggle
          // is on). Entities carry a semantic label.
          const created = await graph.createNode({
            name: node.name,
            type: node.type,
            label: node.label,
            properties: node.properties,
            sourceUrl: llm.sourceUrl ?? undefined,
          });
          if (created) {
            tempIdToRealId.set(node.tempId, created.id);
          }
        }
      }

      // Second pass: create edges and record provenance in edge_sources.
      const updatedGraph = useGraphStore.getState();
      const allReviewTempIds = new Set(reviewStore.nodes.map((n) => n.tempId));
      const createdEdgeIds: string[] = [];

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
          // Let the DB layer auto-derive `type` from the label via
          // ontology_edge_types (Phase 3). We intentionally omit `type` here
          // so createEdge's lookup runs. skipProvenance suppresses the
          // default 'user' attribution; we write an 'extraction' row below.
          const created = await updatedGraph.createEdge({
            sourceId,
            targetId,
            label: edge.label,
            sourceUrl: llm.sourceUrl ?? undefined,
            skipProvenance: true,
          });
          if (created) {
            createdEdgeIds.push(created.id);
          }
        }
      }

      // Record edge provenance. Every LLM-emitted edge is attributed to the
      // extraction with the resource node as its anchor. Notes (below) can
      // additionally source edges via source_type='note'.
      if (createdEdgeIds.length > 0 && resourceNode) {
        await Promise.all(
          createdEdgeIds.map((edgeId) =>
            edgeSources.add({
              edgeId,
              sourceType: 'extraction',
              resourceId: resourceNode!.id,
            }).catch(() => {
              // Best-effort: row already exists
            })
          )
        );
      }

      // Third pass: create note nodes and their about/mention/extracted_from edges.
      // Notes have globally-unique names; on collision we auto-suffix with the
      // source domain. If that still collides we suffix with a timestamp.
      const noteCreatedIds: string[] = [];
      const domainSuffix = resourceNode
        ? (() => {
            try {
              return new URL(resourceNode.sourceUrl).hostname;
            } catch {
              return null;
            }
          })()
        : null;

      for (const note of activeReviewNotes) {
        // Map about/mention temp IDs to real entity node IDs.
        const aboutIds: string[] = [];
        const mentionIds: string[] = [];
        for (const eTempId of note.about) {
          const realId = tempIdToRealId.get(eTempId);
          if (realId) aboutIds.push(realId);
        }
        for (const eTempId of note.mentions) {
          const realId = tempIdToRealId.get(eTempId);
          if (realId) mentionIds.push(realId);
        }
        if (aboutIds.length === 0 && mentionIds.length === 0) continue;

        // Create the note node. Handle name collision via unique index on
        // nodes.name WHERE type='note'. Retry with a disambiguating suffix.
        // Content goes to OPFS, not properties (per ADR).
        const wikiLinks = parseMarkdown(note.content).wikiLinks;
        let noteNodeId: string | null = null;
        let candidateName = note.title;
        for (let attempt = 0; attempt < 3 && !noteNodeId; attempt++) {
          try {
            const created = await useGraphStore.getState().createNode({
              name: candidateName,
              type: 'note',
              properties: {
                wikiLinks,
                ...(resourceNode ? { resourceId: resourceNode.id } : {}),
              },
              sourceUrl: llm.sourceUrl ?? undefined,
            });
            if (created) {
              noteNodeId = created.id;
              noteCreatedIds.push(created.id);
              // Write content to OPFS as .md file (canonical source)
              const markdown = generateNoteMarkdown(candidateName, note.content, wikiLinks);
              await writeNote(created.id, markdown);
              // Update FTS search index
              await noteSearch.upsert(created.id, candidateName, stripMarkdownToPlainText(note.content));
            } else {
              break;
            }
          } catch {
            if (attempt === 0 && domainSuffix) {
              candidateName = `${note.title} (${domainSuffix})`;
            } else {
              candidateName = `${note.title} (${Date.now()})`;
            }
          }
        }
        if (!noteNodeId) continue;

        // Edges from note → entity (about / mention) and note → resource (extracted_from).
        const noteEdgeIds: string[] = [];

        for (const entityId of aboutIds) {
          const createdEdge = await useGraphStore.getState().createEdge({
            sourceId: noteNodeId,
            targetId: entityId,
            label: 'about',
            skipProvenance: true,
          });
          if (createdEdge) noteEdgeIds.push(createdEdge.id);
        }
        for (const entityId of mentionIds) {
          const createdEdge = await useGraphStore.getState().createEdge({
            sourceId: noteNodeId,
            targetId: entityId,
            label: 'mention',
            skipProvenance: true,
          });
          if (createdEdge) noteEdgeIds.push(createdEdge.id);
        }
        if (resourceNode) {
          const createdEdge = await useGraphStore.getState().createEdge({
            sourceId: noteNodeId,
            targetId: resourceNode.id,
            label: 'extracted_from',
            skipProvenance: true,
          });
          if (createdEdge) noteEdgeIds.push(createdEdge.id);
        }

        // All note-originated edges get source_type='note' with source_id=note ID.
        await Promise.all(
          noteEdgeIds.map((edgeId) =>
            edgeSources.add({
              edgeId,
              sourceType: 'note',
              sourceId: noteNodeId,
            }).catch(() => {})
          )
        );

        // Entity-source rows: each about/mention entity gets a row linking it
        // to the resource, with the correct relation_type.
        if (resourceNode) {
          await Promise.all([
            ...aboutIds.map((eId) =>
              entitySources.add(eId, resourceNode!.id, 'about').catch(() => {})
            ),
            ...mentionIds.map((eId) =>
              entitySources.add(eId, resourceNode!.id, 'mention').catch(() => {})
            ),
          ]);
        }

        // Run the wikilink parser on the note content to create additional edges.
        try {
          const { createWikilinkEdgesForNote } = await import('../../shared/wikilink-parser');
          await createWikilinkEdgesForNote(noteNodeId, note.content);
        } catch (e) {
          // Wikilink parsing is best-effort; don't fail the whole merge on it.
          console.warn('[Extraction] Wikilink parser failed:', e);
        }
      }

      // Save source content linked to the system-owned resource node.
      if (llm.sourceUrl && llm.inputText && resourceNode) {
        try {
          await sourceContent.save({
            nodeId: resourceNode.id,
            url: llm.sourceUrl,
            content: llm.inputText,
          });
        } catch (e) {
          console.warn('[Extraction] Failed to save source content:', e);
        }
      }

      // Link entity nodes to their source resource (parallelized per Pitfall #20).
      // The three-layer model tracks this in entity_sources with a relation_type
      // distinction (about/mention). Review apply without notes defaults to 'about'.
      if (resourceNode) {
        const entityNodeIds: string[] = [];
        for (const node of activeNodes) {
          if (node.type !== 'entity') continue;
          const realId = tempIdToRealId.get(node.tempId)
            ?? node.mergeRecommendation?.existingNodeId;
          if (realId) entityNodeIds.push(realId);
        }
        if (entityNodeIds.length > 0) {
          await Promise.all(
            entityNodeIds.map((id) =>
              entitySources.add(id, resourceNode!.id, 'about').catch(() => {
                // Best-effort: source link may already exist
              })
            )
          );
        }
      }

      useExtractionReviewStore.getState().reset();
      useLLMStore.getState().reset();
    } catch (e: any) {
      useLLMStore.getState().setError(e.message);
    }
  }, []);

  return { startExtraction, startQuickExtraction, startAgentExtraction, applyDiff, applyReview, proceedToReview };
}
