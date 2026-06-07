---
name: semantic-disambiguation
category: semantic-search
requires: [synapse-mcp, allow-write, embeddings]
---

# Semantic Disambiguation

Test whether graph context can disambiguate nodes with similar names but different graph neighborhoods. Two "Mercury" entities have distinct edges — one connected to planets, the other to chemical elements. Contextual queries should rank the correct Mercury higher.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Embeddings enabled in Synapse settings

## Steps

1. **Record baseline.** Call `get_graph_overview`.

2. **Create ambiguous pair:**
   - `create_node` name="SemEval-C-Mercury (Planet)" type="entity" label="Smallest planet in the solar system"
   - `create_node` name="SemEval-C-Mercury (Element)" type="entity" label="Chemical element, atomic number 80"

3. **Create distinct neighborhoods:**
   - `create_node` name="SemEval-C-Solar System" type="entity" label="The Sun and its orbiting bodies"
   - `create_node` name="SemEval-C-Venus" type="entity" label="Second planet from the Sun"
   - `create_node` name="SemEval-C-Periodic Table" type="entity" label="Arrangement of chemical elements"
   - `create_node` name="SemEval-C-Gold" type="entity" label="Chemical element, atomic number 79"

4. **Create edges:**
   - SemEval-C-Mercury (Planet) → part_of → SemEval-C-Solar System
   - SemEval-C-Mercury (Planet) → neighbors → SemEval-C-Venus
   - SemEval-C-Mercury (Element) → listed_in → SemEval-C-Periodic Table
   - SemEval-C-Mercury (Element) → adjacent_to → SemEval-C-Gold

5. **Wait for embeddings.** Call `get_graph_overview` as a brief pause.

6. **Query 1 — planetary context:** `semantic_search` query="planets orbiting the sun" limit=5. With graph-aware, Mercury (Planet)'s embedding includes `[related] Solar System (→part_of), Venus (→neighbors)`.

7. **Query 2 — chemistry context:** `semantic_search` query="heavy metals and chemical elements" limit=5. Mercury (Element) should rank higher because its neighbors are Periodic Table and Gold.

8. **Query 3 — ambiguous baseline:** `semantic_search` query="mercury" limit=5. Both should appear. Tests that graph context does not break basic retrieval.

## Evaluation Criteria

- [ ] All 6 nodes and 4 edges created without errors
- [ ] Query 1: `semantic_search` for "planets orbiting the sun" returns SemEval-C-Mercury (Planet) ranked higher than SemEval-C-Mercury (Element), OR returns only the planet
- [ ] Query 2: `semantic_search` for "heavy metals and chemical elements" returns SemEval-C-Mercury (Element) ranked higher than SemEval-C-Mercury (Planet), OR returns only the element
- [ ] Query 3: `semantic_search` for "mercury" returns at least one Mercury node

## Cleanup

- Delete all 6 test nodes by searching for prefix "SemEval-C-"
- Verify `search_nodes` query="SemEval-C-" returns empty
