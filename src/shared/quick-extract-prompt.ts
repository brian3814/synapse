/**
 * System prompt for the Quick-extract LLM pass. The notes toggle is the
 * cross-cutting Phase 4 feature — when enabled, we add a `notes[]` array
 * alongside nodes/edges and instruct the LLM to produce focused prose units.
 */
export function getQuickExtractSystemPrompt(notesEnabled: boolean): string {
  const notesBlock = notesEnabled
    ? `
  "notes": [
    {
      "title": "A short, source-specific title",
      "content": "3-10 sentences of focused prose, ideally with [[wikilinks]] to entities from the nodes array.",
      "about": ["Entity Name 1", "Entity Name 2"],
      "mentions": ["Entity Name 3"]
    }
  ],`
    : '';

  const notesRules = notesEnabled
    ? `

Rules for NOTES:
- Produce 2-6 notes per page, one per distinct idea or insight.
- Each note is 3-10 sentences of focused prose — NOT a summary of the whole page.
- Title should be specific to this source (e.g. "Notion's SharedWorker architecture for multi-tab SQLite", NOT "Architecture Overview").
- Use [[Entity Name]] wikilinks in the content to reference entities from the nodes array.
- "about" lists 1-3 entities the note is primarily about (these become the note's main subjects).
- "mentions" lists any other entities the note incidentally references.
- Entity names in about/mentions must match names in the nodes array exactly.`
    : '';

  return `You are a knowledge graph extraction assistant. Given a web page's content, extract the most important entities and relationships in a single pass.

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
- Every node is an entity. Use the "label" field to categorize it semantically. Allowed labels:
    - concept       (abstract idea, topic, field, theory)
    - person        (named individual)
    - organization  (company, institution, research group)
    - technology    (tool, framework, language, protocol)
    - event         (dated occurrence, release, discovery)
    - place         (geographic location)
    - methodology   (process, workflow, design pattern)
- If no label fits, default to "concept".
- Focus on the 5-15 most important entities.
- Include relevant properties as key-value pairs on nodes.
- Include a "tags" array for free-form domain annotations (e.g. ["ai", "research"]).

Rules for EDGES:
- Use consistent, lowercase relationship labels. Prefer this seed vocabulary when applicable:
    - subfield_of, part_of, instance_of, created_by, affiliated_with,
      used_in, builds_on, enables, contradicts, alternative_to,
      preceded_by
- Ensure all edges reference entities that exist in the nodes array by their exact name.
- If none of the seed labels fit, use a short snake_case label describing the relationship.${notesRules}

Return ONLY valid JSON, no other text.`;
}

/** Backwards-compatible default export (notes off). */
export const QUICK_EXTRACT_SYSTEM_PROMPT = getQuickExtractSystemPrompt(false);
