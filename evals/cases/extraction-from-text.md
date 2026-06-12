---
name: extraction-from-text
category: extraction
requires: [synapse-mcp, allow-write]
---

# Entity Extraction from Raw Text

Test entity extraction quality by reading a biographical passage and creating entities and relationships using MCP write tools. The source text is provided inline (no URL fetch required), simulating what the extraction pipeline would produce from pasted content.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Vault has fewer than 500 nodes (to keep search results manageable)

## Steps

1. **Record baseline.** Call `get_graph_overview` and note current node and edge counts.

2. **Read the source text.** Extract entities and relationships from the following passage:

   > Marie Curie was a Polish-French physicist and chemist who conducted pioneering research on radioactivity. She was the first woman to win a Nobel Prize, and the only person to win Nobel Prizes in two different sciences (Physics in 1903, Chemistry in 1911). She was born in Warsaw, Poland and later moved to Paris, France where she studied at the University of Paris (Sorbonne). Together with her husband Pierre Curie, she discovered the elements polonium and radium.

3. **Create entity nodes.** For each key entity identified in the text, call `create_node` with a specific type and descriptive label. Use these types — NOT generic `entity`:
   - `person` — Marie Curie, Pierre Curie
   - `concept` — Radioactivity, Nobel Prize (or `award`)
   - `chemical_element` — Polonium, Radium
   - `institution` — University of Paris / Sorbonne
   - `location` — Warsaw, Paris, Poland, France (or consolidate city+country)

   Aim for 6-10 entities. Include a descriptive `label` for each (e.g., "Polish-French physicist and chemist" for Marie Curie).

4. **Create relationship edges.** For each meaningful relationship, call `create_edge` with a descriptive label:
   - Marie Curie → Radioactivity: `researched`
   - Marie Curie → Nobel Prize: `received` (or two edges for Physics 1903 and Chemistry 1911)
   - Marie Curie → Pierre Curie: `worked_with` or `married_to`
   - Marie Curie → University of Paris: `studied_at`
   - Marie Curie → Warsaw: `born_in`
   - Marie Curie → Paris: `moved_to`
   - Marie Curie → Polonium: `discovered`
   - Marie Curie → Radium: `discovered`
   - Pierre Curie → Polonium: `discovered`
   - Pierre Curie → Radium: `discovered`

   Aim for at least 5 edges. Every entity should have at least one connection.

5. **Verify entities.** Call `search_nodes` query="Curie" — both Marie and Pierre should appear. Then `search_nodes` query="Polonium" and query="Radium" to confirm chemical elements.

6. **Verify relationships.** Call `get_neighbors` on the Marie Curie node. She should be connected to multiple entities (Pierre, elements, locations, institution, etc.).

7. **Check for duplicates.** Call `find_similar_entities` for "Marie Curie", "Polonium", and "University of Paris" — each should return at most the single node you created, not near-duplicates.

8. **Create a summary note.** Call `create_note` with a title like "Marie Curie - Extraction Summary" containing a brief summary of the extracted entities and relationships.

## Evaluation Criteria

- [ ] At least 6 entities extracted from the passage
- [ ] Entity types are specific (`person`, `concept`, `chemical_element`, `institution`, `location`, `award`) — not generic `entity`
- [ ] Marie Curie and Pierre Curie are both present with type `person`
- [ ] Polonium and Radium are present as `chemical_element` (or a similarly specific type)
- [ ] At least 5 edges created with descriptive labels (not just `related_to`)
- [ ] No duplicate entities detected by `find_similar_entities`
- [ ] Every created entity has at least one edge connecting it to another entity
- [ ] `get_neighbors` on Marie Curie returns at least 3 connected entities
- [ ] Summary note created successfully via `create_note`
- [ ] Graph overview counts increased by the expected amounts over baseline

## Cleanup

- Search for all nodes created during this case (search for "Curie", "Polonium", "Radium", "Radioactivity", "Nobel", "Warsaw", "Paris", "Sorbonne")
- Delete each one using `delete_node` (this also removes connected edges)
- Delete the summary note
- Verify `get_graph_overview` returns to baseline counts
