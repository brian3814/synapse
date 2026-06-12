---
name: semantic-baseline-regression
category: semantic-search
requires: [synapse-mcp, allow-write, embeddings]
---

# Semantic Baseline Regression

Ensure that graph-aware embeddings do not degrade basic semantic search. Nodes have rich self-descriptions and NO edges, so graph context adds nothing — both strategies should perform equally well.

## Prerequisites

- synapse-mcp connected with `--allow-write`
- Embeddings enabled in Synapse settings

## Steps

1. **Record baseline.** Call `get_graph_overview`.

2. **Create nodes with rich labels (no edges):**
   - `create_node` name="SemEval-D-Machine Learning" type="entity" label="Subset of artificial intelligence that uses statistical techniques to enable computers to learn from data without being explicitly programmed"
   - `create_node` name="SemEval-D-Kubernetes" type="entity" label="Open-source container orchestration platform for automating deployment, scaling, and management of containerized applications"
   - `create_node` name="SemEval-D-Climate Change" type="entity" label="Long-term shift in global temperatures and weather patterns, primarily driven by human activities since the 1800s"
   - `create_node` name="SemEval-D-CRISPR" type="entity" label="Gene editing technology that allows precise modifications to DNA sequences in living organisms"

3. **Wait for embeddings.** Call `get_graph_overview` as a brief pause.

4. **Query 1:** `semantic_search` query="AI learning from data" limit=5. Should match Machine Learning.

5. **Query 2:** `semantic_search` query="container deployment automation" limit=5. Should match Kubernetes.

6. **Query 3:** `semantic_search` query="global warming and weather" limit=5. Should match Climate Change.

7. **Query 4:** `semantic_search` query="editing genes in organisms" limit=5. Should match CRISPR.

8. **Negative query:** `semantic_search` query="underwater basket weaving" limit=5. Should return no test nodes with high similarity.

## Evaluation Criteria

- [ ] All 4 nodes created without errors
- [ ] Query 1: "AI learning from data" returns SemEval-D-Machine Learning in top 2
- [ ] Query 2: "container deployment automation" returns SemEval-D-Kubernetes in top 2
- [ ] Query 3: "global warming and weather" returns SemEval-D-Climate Change in top 2
- [ ] Query 4: "editing genes in organisms" returns SemEval-D-CRISPR in top 2
- [ ] Negative query does not return any test nodes with similarity > 0.5

## Cleanup

- Delete all 4 test nodes by searching for prefix "SemEval-D-"
- Verify `search_nodes` query="SemEval-D-" returns empty
