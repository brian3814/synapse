import { useCallback } from 'react';
import { storage, notes, llm, browser } from '@platform';
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
    const stored = await storage.get(EXTRACTION_NOTES_ENABLED_KEY) as Record<string, any>;
    return Boolean(stored[EXTRACTION_NOTES_ENABLED_KEY]);
  } catch {
    return false;
  }
}
import { entityResolution, sourceContent, entitySources, edgeSources, noteSearch } from '../../db/client/db-client';
import { generateNoteMarkdown } from '../../notes/markdown-utils';
import { stripMarkdownToPlainText } from '../../notes/markdown-utils';
import { parseMarkdown } from '../../filesystem/markdown-parser';
import type { DiffItem, ExtractedNoteCandidate, EntityMatch } from '../../shared/types';

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
    const disc = await storage.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startExtraction(text, sourceUrl));
      return;
    }

    const llmStore = useLLMStore.getState();
    llmStore.setInputText(text);
    llmStore.setSourceUrl(sourceUrl ?? null);
    llmStore.setError(null);

    // Start agent run with steps
    llmStore.startAgentRun([
      { id: 'extract', label: 'Extracting entities via LLM' },
      { id: 'parse', label: 'Parsing response' },
    ]);

    llmStore.setStatus('extracting');

    try {
      const result = await storage.get('llmConfig') as Record<string, any>;
      const config = result.llmConfig;
      if (!config?.apiKey) {
        throw new Error('No API key configured. Go to Settings to add one.');
      }

      const notesOn = await isNotesEnabled();

      const streamResult = await llm.streamExtraction(
        {
          prompt: text,
          model: config.model,
          systemPrompt: getQuickExtractSystemPrompt(notesOn),
        },
        (chunk) => {
          useLLMStore.getState().appendToCurrentStep(chunk);
        },
        (info) => {
          useLLMStore.getState().setRateLimitWait({
            ...info,
            startedAt: Date.now(),
          });
        },
      );

      useLLMStore.getState().setRateLimitWait(null);
      const costCents = computeCostCents(config.model, streamResult.inputTokens, streamResult.outputTokens);
      useLLMStore.getState().setLastUsage({ inputTokens: streamResult.inputTokens, outputTokens: streamResult.outputTokens, costCents });

      // Complete extract step, advance to parse step
      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().advanceStep();

      const content = streamResult.content
        ?? useLLMStore.getState().agentRun?.steps[0]?.output
        ?? '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = extractionResultSchema.parse(parsed);

      const { items, notes: extractedNotes } = await buildDiffItems(validated);

      // Complete parse step
      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().setDiff({ items, notes: extractedNotes });
      useLLMStore.getState().setStatus('extracted');
    } catch (e: any) {
      const llmState = useLLMStore.getState();
      llmState.failCurrentStep(e.message);
      llmState.setError(e.message);
    }
  }, []);

  const startQuickExtraction = useCallback(async (prompt?: string, sourceUrl?: string) => {
    // Privacy disclosure gate
    const disc = await storage.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startQuickExtraction(prompt, sourceUrl));
      return;
    }

    const llmStore = useLLMStore.getState();
    llmStore.setError(null);

    // Get LLM config
    const result = await storage.get('llmConfig') as Record<string, any>;
    const config = result.llmConfig;
    if (!config?.apiKey) {
      llmStore.setError('No API key configured. Go to Settings to add one.');
      return;
    }

    // Fetch page content: from custom URL or current tab
    let pageContent: { title: string; url: string; content: string };
    if (sourceUrl) {
      try {
        const fetchResult = await (browser as any).fetchUrl(sourceUrl);
        if (fetchResult?.error) throw new Error(fetchResult.error);
        const content = fetchResult?.content ?? '';
        const titleMatch = content.match(/^#\s+(.+)/m);
        pageContent = {
          title: titleMatch?.[1]?.trim() ?? sourceUrl,
          url: sourceUrl,
          content,
        };
      } catch (e: any) {
        llmStore.setError(`Failed to fetch URL: ${e.message}`);
        return;
      }
    } else {
      try {
        const result = await (browser as any).getPageContentFull();
        if (!result?.content) throw new Error('No page content received');
        pageContent = result;
      } catch (e: any) {
        llmStore.setError(`Failed to get page content: ${e.message}`);
        return;
      }
    }

    llmStore.setInputText(pageContent.content);
    llmStore.setSourceUrl(pageContent.url);

    llmStore.startAgentRun([
      { id: 'extract', label: 'Quick extracting entities via LLM' },
      { id: 'parse', label: 'Parsing response' },
    ]);

    llmStore.setStatus('extracting');

    const notesOn = await isNotesEnabled();

    try {
      const userContent = prompt
        ? `${prompt}\n\n---\n\nPage content:\n\n${pageContent.content}`
        : `Extract entities and relationships from the following web page:\n\n${pageContent.content}`;

      const streamResult = await llm.streamExtraction(
        {
          prompt: userContent,
          model: config.model,
          systemPrompt: getQuickExtractSystemPrompt(notesOn),
        },
        (chunk) => {
          useLLMStore.getState().appendToCurrentStep(chunk);
        },
        (info) => {
          useLLMStore.getState().setRateLimitWait({
            ...info,
            startedAt: Date.now(),
          });
        },
      );

      useLLMStore.getState().setRateLimitWait(null);
      const costCents = computeCostCents(config.model, streamResult.inputTokens, streamResult.outputTokens);
      useLLMStore.getState().setLastUsage({ inputTokens: streamResult.inputTokens, outputTokens: streamResult.outputTokens, costCents });

      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().advanceStep();

      const content = streamResult.content
        ?? useLLMStore.getState().agentRun?.steps[0]?.output
        ?? '';

      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in LLM response');

      const parsed = JSON.parse(jsonMatch[0]);
      const validated = extractionResultSchema.parse(parsed);
      const { items, notes: extractedNotes } = await buildDiffItems(validated);

      useLLMStore.getState().completeCurrentStep();
      useLLMStore.getState().setDiff({ items, notes: extractedNotes });
      useLLMStore.getState().setStatus('extracted');
    } catch (e: any) {
      const llmState = useLLMStore.getState();
      llmState.failCurrentStep(e.message);
      llmState.setError(e.message);
    }
  }, []);

  const applyDiff = useCallback(async () => {
    const llmStore = useLLMStore.getState();
    const diff = llmStore.diff;
    if (!diff) return;

    llmStore.setStatus('merging');

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
            sourceUrl: llmStore.sourceUrl ?? undefined,
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
            sourceUrl: llmStore.sourceUrl ?? undefined,
            skipProvenance: true,
          });
        }
      }

      // Save source content if we have text and a URL
      if (llmStore.sourceUrl && llmStore.inputText) {
        try {
          // Find or create the resource node for this URL
          const resourceNodeId = nodeIdMap.get(llmStore.sourceUrl.toLowerCase())
            ?? useGraphStore.getState().nodes.find(
              (n) => n.sourceUrl === llmStore.sourceUrl && n.type === 'resource'
            )?.id;

          await sourceContent.save({
            nodeId: resourceNodeId,
            url: llmStore.sourceUrl,
            content: llmStore.inputText,
          });
        } catch (e) {
          console.warn('[Extraction] Failed to save source content:', e);
        }
      }

      // Link entity nodes to their source resource (parallelized per Pitfall #20).
      // The three-layer model tracks this in entity_sources with a relation_type
      // distinction (about/mention). Direct extraction without notes defaults to 'about'.
      if (llmStore.sourceUrl) {
        const resourceNode = useGraphStore.getState().nodes.find(
          (n) => n.sourceUrl === llmStore.sourceUrl && n.type === 'resource'
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
    const disc = await storage.get('privacyDisclosureAccepted') as Record<string, any>;
    if (!disc.privacyDisclosureAccepted) {
      useLLMStore.getState().setShowPrivacyModal(true, () => startAgentExtraction(prompt, sourceUrl));
      return;
    }

    const llmStore = useLLMStore.getState();
    llmStore.setError(null);
    llmStore.clearAgentTurns();

    const tab = await browser.getActiveTab();
    if (!tab?.id) {
      llmStore.setError('No active tab found');
      return;
    }

    // Get LLM config
    const result = await storage.get('llmConfig') as Record<string, any>;
    const config = result.llmConfig;
    if (!config?.apiKey) {
      llmStore.setError('No API key configured. Go to Settings to add one.');
      return;
    }
    if (config.provider !== 'anthropic') {
      llmStore.setError('Page extraction requires an Anthropic API key. Configure one in Settings.');
      return;
    }

    const runId = crypto.randomUUID();
    llmStore.setStatus('agent-running');
    llmStore.setSourceUrl(sourceUrl ?? tab.url ?? null);

    const notesOn = await isNotesEnabled();

    // Build agent prompt: include custom URL if provided, so the agent
    // uses fetch_url to retrieve it instead of reading the active tab.
    let agentPrompt = prompt || 'Extract entities and relationships from this page.';
    if (sourceUrl) {
      agentPrompt = `${agentPrompt}\n\nIMPORTANT: Extract from this URL instead of the current tab: ${sourceUrl}\nUse fetch_url to retrieve its content.`;
    }

    try {
      await llm.runAgent(
        {
          runId,
          userPrompt: agentPrompt,
          model: config.model,
          tabId: tab.id,
          notesEnabled: notesOn,
        },
        async (event) => {
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
              if (event.inputTokens != null && event.model) {
                const costCents = computeCostCents(event.model, event.inputTokens, event.outputTokens ?? 0);
                useLLMStore.getState().setLastUsage({ inputTokens: event.inputTokens, outputTokens: event.outputTokens ?? 0, costCents });
              }
              if (event.extractionResult) {
                try {
                  const validated = extractionResultSchema.parse(event.extractionResult);
                  const { items, notes: extractedNotes } = await buildDiffItems(validated);
                  useLLMStore.getState().setDiff({ items, notes: extractedNotes });
                  useLLMStore.getState().setStatus('extracted');
                } catch (e: any) {
                  useLLMStore.getState().setError(`Failed to parse extraction result: ${e.message}`);
                }
              }
              break;
            }
            case 'error':
              useLLMStore.getState().setError(event.error ?? 'Agent loop failed');
              break;
            case 'done':
              // If status is still agent-running, agent finished without calling save_entities
              if (useLLMStore.getState().status === 'agent-running') {
                useLLMStore.getState().setError('Agent finished without extracting any entities. Try a more specific prompt.');
              }
              break;
          }
        },
      );
    } catch (e: any) {
      useLLMStore.getState().setError(e.message);
    }
  }, []);

  const proceedToReview = useCallback(async () => {
    const llmStore = useLLMStore.getState();
    const diff = llmStore.diff;
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
      .initialize(reviewNodes, reviewEdges, reviewNotes, llmStore.sourceUrl);
    useLLMStore.getState().setStatus('reviewing');
  }, []);

  const applyReview = useCallback(async () => {
    const llmStore = useLLMStore.getState();
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

    llmStore.setStatus('merging');

    try {
      const graph = useGraphStore.getState();
      const tempIdToRealId = new Map<string, string>();

      // Pass 0: deterministically ensure a resource node exists for this source URL.
      // In the three-layer model, resources are system-owned — the LLM never emits
      // them, and the merge always anchors its provenance to a real resource node.
      let resourceNode: { id: string; identifier: string | null; sourceUrl: string } | null = null;
      if (llmStore.sourceUrl) {
        resourceNode = await ensureResourceNode(llmStore.sourceUrl);
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
            sourceUrl: llmStore.sourceUrl ?? undefined,
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
            sourceUrl: llmStore.sourceUrl ?? undefined,
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
              sourceUrl: llmStore.sourceUrl ?? undefined,
            });
            if (created) {
              noteNodeId = created.id;
              noteCreatedIds.push(created.id);
              // Write content to OPFS as .md file (canonical source)
              const markdown = generateNoteMarkdown(candidateName, note.content, wikiLinks);
              await notes.write(created.id, markdown);
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
      if (llmStore.sourceUrl && llmStore.inputText && resourceNode) {
        try {
          await sourceContent.save({
            nodeId: resourceNode.id,
            url: llmStore.sourceUrl,
            content: llmStore.inputText,
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
