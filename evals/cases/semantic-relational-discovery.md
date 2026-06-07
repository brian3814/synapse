---
name: semantic-relational-discovery
category: semantic-search
requires: [synapse-mcp, allow-write, embeddings]
---

# Semantic Relational Discovery

Test whether semantic search can surface nodes based on their graph relationships (edge labels + neighbor names) rather than just their own descriptions. Nodes are created with intentionally sparse labels so keyword search alone would miss relational queries.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Embeddings enabled in Synapse settings

## Steps

1. **Record baseline.** Call `get_graph_overview`.

2. **Create test nodes with sparse labels** (no keyword overlap with queries):
   - `create_node` name="SemEval-A-Dr. Elara Voss" type="entity" label="Senior researcher"
   - `create_node` name="SemEval-A-Project Helios" type="entity" label="Internal research initiative"
   - `create_node` name="SemEval-A-QuantumCore Labs" type="entity" label="Private technology company"
   - `create_node` name="SemEval-A-Neural Lattice Framework" type="entity" label="Software framework"
   - `create_node` name="SemEval-A-Dr. Marcus Chen" type="entity" label="Junior researcher"

3. **Create relationship edges:**
   - SemEval-A-Dr. Elara Voss → leads → SemEval-A-Project Helios
   - SemEval-A-Dr. Elara Voss → works_at → SemEval-A-QuantumCore Labs
   - SemEval-A-Project Helios → develops → SemEval-A-Neural Lattice Framework
   - SemEval-A-Dr. Marcus Chen → reports_to → SemEval-A-Dr. Elara Voss
   - SemEval-A-Dr. Marcus Chen → contributes_to → SemEval-A-Project Helios

4. **Wait for embeddings.** Call `get_graph_overview` as a brief pause for the embedding queue to process.

5. **Query 1 — relational:** `semantic_search` query="Who leads the research project?" limit=5. With graph-aware embeddings, Dr. Elara Voss's embedding includes her `leads` relationship to Project Helios. With basic, her label is just "Senior researcher."

6. **Query 2 — organizational:** `semantic_search` query="technology company developing a framework" limit=5. With graph-aware, QuantumCore Labs's embedding includes connections to Project Helios and Neural Lattice Framework.

7. **Query 3 — team structure:** `semantic_search` query="mentor and mentee relationship" limit=5. With graph-aware, both doctors embed their `reports_to` relationship.

8. **FTS baseline comparison.** Call `search_nodes` query="leads research project" to compare FTS results with semantic results.

## Evaluation Criteria

- [ ] All 5 nodes and 5 edges created without errors
- [ ] Query 1: `semantic_search` for "Who leads the research project?" returns SemEval-A-Dr. Elara Voss in top 3 results
- [ ] Query 2: `semantic_search` for "technology company developing a framework" returns SemEval-A-QuantumCore Labs in top 3 results
- [ ] Query 3: `semantic_search` for "mentor and mentee relationship" returns at least one of the two doctor nodes in top 3
- [ ] Semantic search returns results with non-trivial similarity scores (> 0.3)

## Cleanup

- Delete all 5 test nodes by searching for prefix "SemEval-A-" and deleting each
- Verify `search_nodes` query="SemEval-A-" returns empty
