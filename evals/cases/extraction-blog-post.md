---
name: extraction-blog-post
category: extraction
requires: [synapse-mcp, allow-write]
---

# Blog Post Entity Extraction

Test the extraction pipeline by feeding a technical blog post through the write tools and verifying the resulting graph structure.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Vault has fewer than 500 nodes (to keep search results manageable)

## Steps

1. **Fetch the source content.** Use `WebFetch` to retrieve this blog post:
   `https://www.anthropic.com/engineering/building-effective-agents`
   Extract the main article text (ignore nav, footer, ads).

2. **Record baseline.** Call `get_graph_overview` and note the current node and edge counts.

3. **Create entities.** Read through the fetched content and identify the key entities (people, organizations, concepts, technologies). For each entity, call `create_node` with an appropriate `type` and a descriptive `label`.
   - Aim for 8-15 entities. Don't over-extract (every noun) or under-extract (just the title).
   - Use specific types: `concept`, `technology`, `organization`, `person` — not generic `entity`.

4. **Create relationships.** For each meaningful relationship between the entities you created, call `create_edge` with a descriptive label.
   - Labels should be specific: `uses`, `built_by`, `example_of`, `describes` — not just `related_to`.
   - Every entity should have at least one edge.

5. **Verify the graph.** Call `search_nodes` for 3-4 of the entity names you created. Then call `get_node_details` on 2-3 of them to inspect edges.

6. **Check for duplicates.** Call `find_similar_entities` for 2-3 entity names to verify no duplicates were created.

## Evaluation Criteria

- [ ] At least 8 entities created from the blog post content
- [ ] No more than 20 entities (avoids over-extraction of trivial terms)
- [ ] Every entity has a non-empty `label` field
- [ ] Entity types are specific (`concept`, `technology`, `person`, `organization`) — not generic `entity` or `thing`
- [ ] At least 6 edges created connecting the entities
- [ ] Edge labels are descriptive (not just `related_to` or `associated_with`)
- [ ] No duplicate entities (find_similar_entities returns no near-matches within the created set)
- [ ] Key concepts from the article are represented (e.g., "agents", "tool use", "retrieval", or similar core topics)
- [ ] Every created entity has at least one edge connecting it to another entity

## Cleanup

- Search for all nodes created during this case (they'll be the most recently created)
- Delete each one using `delete_node` (this also removes connected edges)
