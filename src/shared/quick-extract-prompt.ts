export interface ExtractionGraphContext {
  entityLabels: string[];
  edgeLabels: string[];
}

function buildEntityLabelBlock(ctx?: ExtractionGraphContext): string {
  if (ctx && ctx.entityLabels.length > 0) {
    const list = ctx.entityLabels.join(', ');
    return `- Every node is an entity. Use the "label" field to categorize it semantically.
- STRONGLY PREFER reusing an existing label. Only create a new label if none of the existing ones adequately describe the entity.
- Existing entity labels in this graph: ${list}
- If you must create a new label, use a short lowercase snake_case term.`;
  }
  return `- Every node is an entity. Use the "label" field to categorize it semantically (e.g. concept, person, organization, technology).
- Use short lowercase snake_case labels.`;
}

function buildEdgeLabelBlock(ctx?: ExtractionGraphContext): string {
  if (ctx && ctx.edgeLabels.length > 0) {
    const list = ctx.edgeLabels.join(', ');
    return `- STRONGLY PREFER reusing an existing relationship label. Only create a new label if none of the existing ones adequately describe the relationship.
- Existing relationship labels in this graph: ${list}
- If you must create a new label, use consistent lowercase snake_case (e.g. "works_at", "located_in").`;
  }
  return `- Use consistent, lowercase snake_case relationship labels (e.g. "created_by", "part_of", "used_in", "works_at").`;
}

/**
 * System prompt for the Quick-extract LLM pass. Accepts optional graph context
 * to inject existing entity labels and edge labels dynamically.
 */
export function getQuickExtractSystemPrompt(
  notesEnabled: boolean,
  customInstructions?: string,
  graphContext?: ExtractionGraphContext,
): string {
  const notesBlock = notesEnabled
    ? `
  "notes": [
    {
      "title": "Summary: <page title>",
      "content": "## TL;DR\\n2-3 sentence summary.\\n\\n## Section Title\\nDescription...\\n\\n| Col1 | Col2 |\\n|---|---|\\n| data | data |",
      "about": ["Entity Name 1"],
      "mentions": ["Entity Name 2"]
    }
  ],`
    : '';

  const notesRules = notesEnabled
    ? `

Rules for NOTES:
- Produce exactly ONE note — a structured summary of the entire resource.
- Title: "Summary: <page title>"
- The note content MUST be markdown with this structure:
  1. **TL;DR** section first (## TL;DR) — 2-3 sentences capturing the core message.
  2. Then 3-5 **sections** that break down the content by topic/theme. Each section: ## heading + descriptive paragraph.
  3. Include **markdown tables** where the page has structured/comparative data (features, specs, comparisons, timelines). Reproduce key tables from the source.
  4. Include **images** where relevant using ![description](image_url) with original URLs from the page. Only diagrams, charts, and screenshots — not decorative images.
- Use [[Entity Name]] wikilinks to reference entities from the nodes array.
- "about" lists 1-3 key entities the note covers. "mentions" lists other referenced entities.
- Entity names in about/mentions must match names in the nodes array exactly.`
    : '';

  return `You are a knowledge graph extraction assistant for Synapse, a local-first personal knowledge graph. Given content — which may be text from a web page, a PDF, an image description, pasted notes, or any other source — extract the most important entities and relationships in a single pass. Your output goes through a review flow where the user can edit, merge, or remove items before committing.

Output format:
{
  "nodes": [
    { "name": "Entity Name", "label": "semantic_label", "properties": { "key": "value" }, "tags": ["domain_tag"] }
  ],
  "edges": [
    { "sourceName": "Source Entity", "targetName": "Target Entity", "label": "relationship_label" }
  ]${notesBlock ? ',' : ''}${notesBlock}
}

Rules for NODES:
- Do NOT output resource nodes — the system automatically creates a resource node for the source URL. Only output entities.
${buildEntityLabelBlock(graphContext)}
- Focus on the 5-15 most important entities.
- Include relevant properties as key-value pairs on nodes.
- Include a "tags" array for free-form domain annotations (e.g. ["ai", "research"]).

Rules for EDGES:
${buildEdgeLabelBlock(graphContext)}
- Ensure all edges reference entities that exist in the nodes array by their exact name.${notesRules}

Return ONLY valid JSON, no other text.${customInstructions ? `\n\n## Custom Instructions\n${customInstructions}` : ''}`;
}

/** Backwards-compatible default export (notes off, no graph context). */
export const QUICK_EXTRACT_SYSTEM_PROMPT = getQuickExtractSystemPrompt(false);
