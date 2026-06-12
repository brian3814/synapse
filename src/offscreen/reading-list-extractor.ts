import { isBlockedUrl, fetchAndCleanContent } from './url-utils';
import { readingListExtractionSchema } from '../shared/schema';

const READING_LIST_SYSTEM_PROMPT = `You are a reading assistant. Given a web page's content, produce:
1. A concise 2-3 sentence summary
2. 3-7 key topics as short labels
3. Important entities (nodes) and relationships (edges) for a knowledge graph

Return ONLY valid JSON:
{
  "summary": "...",
  "keyTopics": ["topic1", "topic2"],
  "nodes": [{ "name": "...", "label": "semantic_label", "properties": {...}, "tags": ["..."] }],
  "edges": [{ "sourceName": "...", "targetName": "...", "label": "..." }]
}

Rules:
- Do NOT output resource nodes. The source URL is automatically tracked as a resource by the system.
- Every node is an entity. Use the "label" field to categorize it semantically. Allowed labels:
  concept, person, organization, technology, event, place, methodology.
- If no label fits, default to "concept".
- Extract the most important entities and relationships.
- Use consistent, lowercase relationship labels (e.g., "works_at", "located_in", "built_by").
- Include a tags array for domain annotations (e.g. ["technology", "ai"]).
- Include relevant properties as key-value pairs.
- Ensure all edges reference entities that exist in the nodes array by their exact name.`;

const READING_LIST_FETCH_MAX_BYTES = 100_000;

export async function extractReadingListItem(payload: {
  url: string;
  title: string;
  apiKey: string;
  model: string;
}): Promise<{
  url: string;
  success: boolean;
  summary?: string;
  keyTopics?: string[];
  nodes?: Array<{
    name: string;
    type?: string;
    label?: string;
    properties?: Record<string, unknown>;
    tags?: string[];
  }>;
  edges?: Array<{ sourceName: string; targetName: string; label: string; type?: string }>;
  pageContent?: string;
  pageTitle?: string;
  error?: string;
  inputTokens?: number;
  outputTokens?: number;
  model?: string;
}> {
  const { url, title, apiKey, model } = payload;

  // 1. Check blocked URL
  if (isBlockedUrl(url)) {
    return { url, success: false, error: 'Blocked: requests to private/internal network addresses are not allowed' };
  }

  // 2. Fetch and clean HTML
  const { content: pageContent, error: fetchError } = await fetchAndCleanContent(url, READING_LIST_FETCH_MAX_BYTES);
  if (fetchError) {
    return { url, success: false, error: fetchError };
  }
  if (!pageContent || pageContent.trim().length === 0) {
    return { url, success: false, error: 'Page content is empty' };
  }

  // 3. Call Anthropic API (non-streaming, single call)
  const userMessage = `Page title: ${title}\nURL: ${url}\n\nPage content:\n${pageContent}`;

  let response: Response;
  try {
    response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        system: READING_LIST_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
        temperature: 0.1,
      }),
    });
  } catch (e: any) {
    return { url, success: false, error: `API request failed: ${e.message}` };
  }

  if (!response.ok) {
    const errorText = await response.text();
    return { url, success: false, error: `Anthropic API error (${response.status}): ${errorText}` };
  }

  // 4. Parse response JSON, extract text content
  let responseBody: any;
  try {
    responseBody = await response.json();
  } catch {
    return { url, success: false, error: 'Failed to parse API response as JSON' };
  }

  const usageInputTokens: number = responseBody?.usage?.input_tokens ?? 0;
  const usageOutputTokens: number = responseBody?.usage?.output_tokens ?? 0;

  const textBlock = responseBody?.content?.[0]?.text;
  if (!textBlock) {
    return { url, success: false, error: 'No text content in API response' };
  }

  // 5. Find JSON in response text
  const jsonMatch = textBlock.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { url, success: false, error: 'No JSON found in API response text' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return { url, success: false, error: 'Failed to parse extracted JSON from response' };
  }

  // 6. Validate with schema
  const validation = readingListExtractionSchema.safeParse(parsed);
  if (!validation.success) {
    return { url, success: false, error: `Schema validation failed: ${validation.error.message}` };
  }

  const result = validation.data;

  // 7. Return success result
  return {
    url,
    success: true,
    summary: result.summary,
    keyTopics: result.keyTopics,
    nodes: result.nodes,
    edges: result.edges,
    pageContent,
    pageTitle: title,
    inputTokens: usageInputTokens,
    outputTokens: usageOutputTokens,
    model,
  };
}
